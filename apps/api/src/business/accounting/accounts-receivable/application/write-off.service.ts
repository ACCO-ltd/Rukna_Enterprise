import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { ReceivableWriteOffView, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ACCOUNTING_POSTING_PORT, type IAccountingPostingPort } from '../../accounting-core/application/ports/accounting-posting.port.js';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import { AccountingConfigurationService } from '../../accounting-core/application/accounting-configuration.service.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { DEFAULT_APPROVAL_SETTINGS, writeOffNeedsApproval } from '../../accounting-core/domain/approval-settings.js';

type TenantPrisma = PrismaClient;

const AMOUNT = /^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/;

export interface RequestWriteOffInput {
  invoiceId: string;
  amount: string;
  reason: 'BAD_DEBT' | 'SMALL_BALANCE';
  accountingDate: string;
  note?: string;
}

/**
 * AR-4 — writing off what a client will not pay: a bad debt, or a small leftover (bank charges,
 * rounding). Dr Bad debts / Cr Accounts receivable, tagged with the client and project, and the
 * invoice balance falls.
 *
 * Owner decision 2026-10-29: up to the organisation's limit (`writeOffApprovalAbove`, default
 * $50) it posts at once; above it, it waits in Approvals for a second person — never the one who
 * asked. A posted write-off can be reversed; the balance comes back. Nothing is ever deleted.
 */
@Injectable()
export class WriteOffService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort: IAccountingPostingPort,
    @Optional() private readonly accountingConfig?: AccountingConfigurationService,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async listForInvoice(identity: RequestIdentity, invoiceId: string): Promise<ReceivableWriteOffView[]> {
    const prisma = this.prisma();
    const rows = await prisma.receivableWriteOff.findMany({
      where: { organizationId: identity.activeOrganizationId, invoiceId },
      orderBy: { requestedAt: 'asc' },
    });
    return this.views(prisma, rows);
  }

  async request(identity: RequestIdentity, input: RequestWriteOffInput): Promise<ReceivableWriteOffView> {
    const prisma = this.prisma();
    const orgId = identity.activeOrganizationId;
    if (!AMOUNT.test(input.amount)) {
      throw new BadRequestException({ errorCode: 'WRITE_OFF_AMOUNT_INVALID', message: 'Give a positive amount with at most two decimals.' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.accountingDate)) {
      throw new BadRequestException({ errorCode: 'WRITE_OFF_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    const invoice = await prisma.clientInvoice.findFirst({
      where: { id: input.invoiceId, organizationId: orgId },
      select: { id: true, clientId: true, postingStatus: true, documentStatus: true, outstandingAmount: true },
    });
    if (!invoice) throw new NotFoundException({ errorCode: 'INVOICE_NOT_FOUND', message: `Invoice ${input.invoiceId} not found` });
    if (!['POSTED', 'OPENING_BALANCE'].includes(invoice.postingStatus) || invoice.documentStatus === 'CANCELLED') {
      throw new BadRequestException({ errorCode: 'INVOICE_NOT_OPEN', message: 'Only an issued invoice with a balance can be written off.' });
    }
    const amount = new Decimal(input.amount);
    const pending = await prisma.receivableWriteOff.aggregate({
      where: { organizationId: orgId, invoiceId: invoice.id, status: 'PENDING_APPROVAL' },
      _sum: { amount: true },
    });
    const available = new Decimal(invoice.outstandingAmount.toString()).minus(pending._sum.amount?.toString() ?? '0');
    if (amount.gt(available)) {
      throw new BadRequestException({
        errorCode: 'WRITE_OFF_EXCEEDS_BALANCE',
        message: `The write-off (${amount.toFixed(2)}) is more than the balance still open (${available.toFixed(2)}).`,
        details: { available: available.toFixed(2) },
      });
    }

    const settings = (await this.accountingConfig?.getApprovalSettings(orgId)) ?? DEFAULT_APPROVAL_SETTINGS;
    const needsApproval = writeOffNeedsApproval(settings, amount);
    // The ledger must be able to take it before anything is saved — a write-off is never left
    // waiting because its accounts are missing.
    await this.accounts(prisma, orgId);
    const created = await prisma.receivableWriteOff.create({
      data: {
        organizationId: orgId,
        invoiceId: invoice.id,
        clientId: invoice.clientId,
        reason: input.reason,
        note: input.note?.trim() || null,
        amount,
        accountingDate: new Date(`${input.accountingDate}T00:00:00.000Z`),
        status: 'PENDING_APPROVAL',
        requestedBy: identity.userId,
      },
    });
    if (needsApproval) return (await this.views(prisma, [created]))[0]!;
    try {
      await this.post(identity, created.id, null);
    } catch (error) {
      // It never posted and never waited for anyone: nothing to keep.
      await prisma.receivableWriteOff.delete({ where: { id: created.id } });
      throw error;
    }
    return this.view(identity, created.id);
  }

  /** A second person approves a write-off above the limit; it posts at once. */
  async approve(identity: RequestIdentity, id: string): Promise<ReceivableWriteOffView> {
    const writeOff = await this.find(identity, id);
    if (writeOff.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({ errorCode: 'WRITE_OFF_NOT_PENDING', message: 'This write-off is not waiting for approval.' });
    }
    if (writeOff.requestedBy === identity.userId) {
      throw new ForbiddenException({ errorCode: 'WRITE_OFF_SELF_APPROVAL', message: 'Someone other than the person who asked must approve a write-off.' });
    }
    await this.post(identity, id, identity.userId);
    return this.view(identity, id);
  }

  async reject(identity: RequestIdentity, id: string, reason: string): Promise<ReceivableWriteOffView> {
    const writeOff = await this.find(identity, id);
    if (writeOff.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({ errorCode: 'WRITE_OFF_NOT_PENDING', message: 'This write-off is not waiting for approval.' });
    }
    if ((reason ?? '').trim().length < 3) {
      throw new BadRequestException({ errorCode: 'REJECTION_REASON_REQUIRED', message: 'Say why the write-off is rejected.' });
    }
    await this.prisma().receivableWriteOff.update({
      where: { id },
      data: { status: 'REJECTED', rejectedBy: identity.userId, rejectedAt: new Date(), rejectionReason: reason.trim() },
    });
    return this.view(identity, id);
  }

  /** A posted write-off made in error (the client paid after all): a mirror journal; the balance comes back. */
  async reverse(identity: RequestIdentity, id: string, input: { reversalDate: string; reason: string }): Promise<ReceivableWriteOffView> {
    const prisma = this.prisma();
    const writeOff = await this.find(identity, id);
    if (writeOff.status !== 'POSTED' || !writeOff.postedJournalEntryId) {
      throw new ConflictException({ errorCode: 'WRITE_OFF_NOT_POSTED', message: 'Only a posted write-off can be reversed.' });
    }
    if ((input.reason ?? '').trim().length < 3) {
      throw new BadRequestException({ errorCode: 'REVERSAL_REASON_REQUIRED', message: 'Say why the write-off is reversed.' });
    }
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: writeOff.postedJournalEntryId }, include: { lines: true } });
    await prisma.$transaction(async (tx) => {
      const result = await this.postingPort.post(
        {
          organizationId: identity.activeOrganizationId,
          accountingDate: new Date(`${input.reversalDate}T00:00:00.000Z`),
          documentDate: new Date(`${input.reversalDate}T00:00:00.000Z`),
          description: `Reversal of write-off ${writeOff.writeOffNumber}: ${input.reason.trim()}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-AR-010',
          sourceDocumentType: 'RECEIVABLE_WRITE_OFF',
          sourceDocumentId: `reversal-${writeOff.id}`,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AR',
          reversalOfJournalEntryId: original.id,
          createdBy: identity.userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            clientId: l.clientId ?? undefined,
            projectId: l.projectId ?? undefined,
            contractId: l.contractId ?? undefined,
          })),
        },
        tx as never,
      );
      await tx.receivableWriteOff.update({
        where: { id },
        data: {
          status: 'REVERSED',
          reversedBy: identity.userId,
          reversedAt: new Date(),
          reversalReason: input.reason.trim(),
          reversalJournalEntryId: result.journalEntryId,
        },
      });
      await tx.clientInvoice.update({ where: { id: writeOff.invoiceId }, data: { outstandingAmount: { increment: writeOff.amount } } });
      await this.audit(tx, identity, id, 'RECEIVABLE_WRITE_OFF_REVERSED');
    });
    return this.view(identity, id);
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private prisma(): TenantPrisma {
    return this.tenancyService.getClient() as unknown as TenantPrisma;
  }

  private async find(identity: RequestIdentity, id: string) {
    const row = await this.prisma().receivableWriteOff.findFirst({ where: { id, organizationId: identity.activeOrganizationId } });
    if (!row) throw new NotFoundException({ errorCode: 'WRITE_OFF_NOT_FOUND', message: `Write-off ${id} not found` });
    return row;
  }

  private async view(identity: RequestIdentity, id: string): Promise<ReceivableWriteOffView> {
    return (await this.views(this.prisma(), [await this.find(identity, id)]))[0]!;
  }

  /** Posts a write-off (Dr Bad debts / Cr AR) and lowers the invoice balance, under a row lock. */
  private async post(identity: RequestIdentity, id: string, approvedBy: string | null) {
    const prisma = this.prisma();
    const orgId = identity.activeOrganizationId;
    const writeOff = await this.find(identity, id);
    const invoice = await prisma.clientInvoice.findFirstOrThrow({
      where: { id: writeOff.invoiceId, organizationId: orgId },
      select: { invoiceNumber: true, projectId: true, contractId: true, currencyCode: true },
    });
    const { expense, ar } = await this.accounts(prisma, orgId);
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'RECEIVABLE_WRITE_OFF', 'WO-');

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ outstanding_amount: unknown }>>`
        SELECT outstanding_amount FROM client_invoices WHERE id = ${writeOff.invoiceId} AND organization_id = ${orgId} FOR UPDATE`;
      const outstanding = new Decimal(String(locked[0]?.outstanding_amount ?? '0'));
      const amount = new Decimal(writeOff.amount.toString());
      if (amount.gt(outstanding)) {
        throw new BadRequestException({
          errorCode: 'WRITE_OFF_EXCEEDS_BALANCE',
          message: `The invoice now owes ${outstanding.toFixed(2)}; the write-off (${amount.toFixed(2)}) is more than that.`,
          details: { available: outstanding.toFixed(2) },
        });
      }
      const number = await this.sequenceRepo.claimNext(tx as never, orgId, 'RECEIVABLE_WRITE_OFF');
      const tags = { clientId: writeOff.clientId, projectId: invoice.projectId ?? undefined, contractId: invoice.contractId ?? undefined };
      const result = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: writeOff.accountingDate,
          documentDate: writeOff.accountingDate,
          description: `Write-off ${number.formattedNumber} of ${invoice.invoiceNumber ?? 'opening balance'}`,
          currencyCode: invoice.currencyCode,
          eventType: 'EVT-AR-009',
          sourceDocumentType: 'RECEIVABLE_WRITE_OFF',
          sourceDocumentId: writeOff.id,
          journalCategory: 'ACCOUNTS_RECEIVABLE',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_AR',
          createdBy: identity.userId,
          lines: [
            { accountId: expense.id, debitAmount: amount, creditAmount: new Decimal(0), ...tags },
            { accountId: ar.id, debitAmount: new Decimal(0), creditAmount: amount, sourceSubledgerType: 'ACCOUNTS_RECEIVABLE' as const, ...tags },
          ],
        },
        tx as never,
      );
      await tx.receivableWriteOff.update({
        where: { id },
        data: {
          status: 'POSTED',
          writeOffNumber: number.formattedNumber,
          postedJournalEntryId: result.journalEntryId,
          postedAt: new Date(),
          ...(approvedBy ? { approvedBy, approvedAt: new Date() } : {}),
        },
      });
      await tx.clientInvoice.update({ where: { id: writeOff.invoiceId }, data: { outstandingAmount: { decrement: amount } } });
      await this.audit(tx, identity, id, approvedBy ? 'RECEIVABLE_WRITE_OFF_APPROVED' : 'RECEIVABLE_WRITE_OFF_POSTED');
    });
  }

  /** Bad debts and Accounts receivable, or a coded refusal saying what to set up. */
  private async accounts(prisma: TenantPrisma, orgId: string) {
    const expense = await this.resolver.resolveByCodeOrRole(prisma as never, orgId, undefined, 'BAD_DEBT_EXPENSE').catch(() => {
      throw new BadRequestException({
        errorCode: 'BAD_DEBT_ACCOUNT_NOT_CONFIGURED',
        message: 'Mark one expense account as "Bad debts" in the chart of accounts before writing off a balance.',
      });
    });
    const ar = await this.resolver.resolveByCodeOrRole(prisma as never, orgId, undefined, 'ACCOUNTS_RECEIVABLE');
    return { expense, ar };
  }

  private async audit(tx: unknown, identity: RequestIdentity, id: string, eventType: string) {
    await this.auditOutbox?.record(tx as never, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: 'UPDATE',
      resourceType: 'ReceivableWriteOff',
      resourceId: id,
      sourceCommand: `accountsReceivable.${eventType}`,
      eventType,
      idempotencyKey: `${eventType}:${id}`,
    } as never);
  }

  private async views(
    prisma: TenantPrisma,
    rows: Array<Awaited<ReturnType<TenantPrisma['receivableWriteOff']['findFirstOrThrow']>>>,
  ): Promise<ReceivableWriteOffView[]> {
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.approvedBy, r.rejectedBy].filter((x): x is string => Boolean(x))))];
    const users = userIds.length
      ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } })
      : [];
    const name = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      invoiceId: r.invoiceId,
      writeOffNumber: r.writeOffNumber,
      reason: r.reason,
      note: r.note,
      amount: r.amount.toFixed(2),
      accountingDate: r.accountingDate.toISOString().slice(0, 10),
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByName: name.get(r.requestedBy) ?? null,
      requestedAt: r.requestedAt.toISOString(),
      approvedByName: r.approvedBy ? (name.get(r.approvedBy) ?? null) : null,
      rejectedByName: r.rejectedBy ? (name.get(r.rejectedBy) ?? null) : null,
      rejectionReason: r.rejectionReason,
      reversalReason: r.reversalReason,
      reversedAt: r.reversedAt?.toISOString() ?? null,
    }));
  }
}
