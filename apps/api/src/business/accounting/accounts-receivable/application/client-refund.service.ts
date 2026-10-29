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
import type { ClientRefundView, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ACCOUNTING_POSTING_PORT, type IAccountingPostingPort } from '../../accounting-core/application/ports/accounting-posting.port.js';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import { AccountingConfigurationService } from '../../accounting-core/application/accounting-configuration.service.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { DEFAULT_APPROVAL_SETTINGS, paymentApprovedOnSave } from '../../accounting-core/domain/approval-settings.js';

type TenantPrisma = PrismaClient;

const AMOUNT = /^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/;

export interface RequestRefundInput {
  receiptId: string;
  bankAccountId: string;
  amount: string;
  refundDate: string;
  reason: string;
  reference?: string;
}

/**
 * AR-5 — paying back cash a client paid in advance or overpaid, which sits on account on a
 * receipt (owner decision 2026-10-29). Dr Unapplied client receipts / Cr the bank, tagged with the
 * client; the receipt holds that much less on account.
 *
 * Money leaves the bank, so it follows the payment rule (ADR-046 §4): up to the organisation's
 * payment limit (`paymentAutoApproveUpTo`, default $1,000) it posts at once; above it a second
 * person approves. A posted refund can be reversed (the cash is on account again).
 */
@Injectable()
export class ClientRefundService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort: IAccountingPostingPort,
    @Optional() private readonly accountingConfig?: AccountingConfigurationService,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async listForReceipt(identity: RequestIdentity, receiptId: string): Promise<ClientRefundView[]> {
    const prisma = this.prisma();
    const rows = await prisma.clientRefund.findMany({
      where: { organizationId: identity.activeOrganizationId, receiptId },
      orderBy: { requestedAt: 'asc' },
      include: { receipt: { select: { receiptNumber: true } } },
    });
    return this.views(prisma, rows);
  }

  async request(identity: RequestIdentity, input: RequestRefundInput): Promise<ClientRefundView> {
    const prisma = this.prisma();
    const orgId = identity.activeOrganizationId;
    if (!AMOUNT.test(input.amount)) {
      throw new BadRequestException({ errorCode: 'REFUND_AMOUNT_INVALID', message: 'Give a positive amount with at most two decimals.' });
    }
    if ((input.reason ?? '').trim().length < 3) {
      throw new BadRequestException({ errorCode: 'REFUND_REASON_REQUIRED', message: 'Say why the money is paid back.' });
    }
    const receipt = await prisma.paymentReceipt.findFirst({ where: { id: input.receiptId, organizationId: orgId } });
    if (!receipt) throw new NotFoundException({ errorCode: 'RECEIPT_NOT_FOUND', message: `Receipt ${input.receiptId} not found` });
    if (receipt.postingStatus !== 'POSTED') {
      throw new BadRequestException({ errorCode: 'RECEIPT_NOT_POSTED', message: 'Only cash on a posted receipt can be paid back.' });
    }
    const bank = await prisma.bankAccount.findFirst({ where: { id: input.bankAccountId, organizationId: orgId } });
    if (!bank) throw new NotFoundException({ errorCode: 'BANK_ACCOUNT_NOT_FOUND', message: `Bank account ${input.bankAccountId} not found` });
    if (bank.status !== 'ACTIVE' || !bank.allowsPayments) {
      throw new BadRequestException({ errorCode: 'BANK_ACCOUNT_NOT_PAYING', message: `${bank.accountName} does not make payments.` });
    }
    if (bank.currencyCode !== receipt.currencyCode) {
      throw new BadRequestException({ errorCode: 'CURRENCY_MISMATCH', message: 'The bank account and the receipt are in different currencies.' });
    }
    const amount = new Decimal(input.amount);
    const pending = await prisma.clientRefund.aggregate({
      where: { organizationId: orgId, receiptId: receipt.id, status: 'PENDING_APPROVAL' },
      _sum: { amount: true },
    });
    const available = new Decimal(receipt.unallocatedAmount.toString()).minus(pending._sum.amount?.toString() ?? '0');
    if (amount.gt(available)) {
      throw new BadRequestException({
        errorCode: 'REFUND_EXCEEDS_ON_ACCOUNT',
        message: `The refund (${amount.toFixed(2)}) is more than this receipt holds on account (${available.toFixed(2)}).`,
        details: { available: available.toFixed(2) },
      });
    }
    await this.unappliedAccount(prisma, orgId);

    const settings = (await this.accountingConfig?.getApprovalSettings(orgId)) ?? DEFAULT_APPROVAL_SETTINGS;
    const postsNow = paymentApprovedOnSave(settings, amount);
    const created = await prisma.clientRefund.create({
      data: {
        organizationId: orgId,
        clientId: receipt.clientId,
        receiptId: receipt.id,
        bankAccountId: bank.id,
        amount,
        refundDate: new Date(`${input.refundDate}T00:00:00.000Z`),
        reference: input.reference?.trim() || null,
        reason: input.reason.trim(),
        status: 'PENDING_APPROVAL',
        requestedBy: identity.userId,
      },
    });
    if (!postsNow) return this.view(identity, created.id);
    try {
      await this.post(identity, created.id, null);
    } catch (error) {
      await prisma.clientRefund.delete({ where: { id: created.id } });
      throw error;
    }
    return this.view(identity, created.id);
  }

  async approve(identity: RequestIdentity, id: string): Promise<ClientRefundView> {
    const refund = await this.find(identity, id);
    if (refund.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({ errorCode: 'REFUND_NOT_PENDING', message: 'This refund is not waiting for approval.' });
    }
    if (refund.requestedBy === identity.userId) {
      throw new ForbiddenException({ errorCode: 'REFUND_SELF_APPROVAL', message: 'Someone other than the person who asked must approve a refund.' });
    }
    await this.post(identity, id, identity.userId);
    return this.view(identity, id);
  }

  async reject(identity: RequestIdentity, id: string, reason: string): Promise<ClientRefundView> {
    const refund = await this.find(identity, id);
    if (refund.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({ errorCode: 'REFUND_NOT_PENDING', message: 'This refund is not waiting for approval.' });
    }
    if ((reason ?? '').trim().length < 3) {
      throw new BadRequestException({ errorCode: 'REJECTION_REASON_REQUIRED', message: 'Say why the refund is rejected.' });
    }
    await this.prisma().clientRefund.update({
      where: { id },
      data: { status: 'REJECTED', rejectedBy: identity.userId, rejectedAt: new Date(), rejectionReason: reason.trim() },
    });
    return this.view(identity, id);
  }

  /** A refund recorded in error (the transfer never went): a mirror journal; the cash is on account again. */
  async reverse(identity: RequestIdentity, id: string, input: { reversalDate: string; reason: string }): Promise<ClientRefundView> {
    const prisma = this.prisma();
    const refund = await this.find(identity, id);
    if (refund.status !== 'POSTED' || !refund.postedJournalEntryId) {
      throw new ConflictException({ errorCode: 'REFUND_NOT_POSTED', message: 'Only a posted refund can be reversed.' });
    }
    if ((input.reason ?? '').trim().length < 3) {
      throw new BadRequestException({ errorCode: 'REVERSAL_REASON_REQUIRED', message: 'Say why the refund is reversed.' });
    }
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: refund.postedJournalEntryId }, include: { lines: true } });
    await prisma.$transaction(async (tx) => {
      const result = await this.postingPort.post(
        {
          organizationId: identity.activeOrganizationId,
          accountingDate: new Date(`${input.reversalDate}T00:00:00.000Z`),
          documentDate: new Date(`${input.reversalDate}T00:00:00.000Z`),
          description: `Reversal of refund ${refund.refundNumber}: ${input.reason.trim()}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-AR-012',
          sourceDocumentType: 'CLIENT_REFUND',
          sourceDocumentId: `reversal-${refund.id}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: original.id,
          createdBy: identity.userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.creditAmount as unknown as Decimal,
            creditAmount: l.debitAmount as unknown as Decimal,
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            clientId: l.clientId ?? undefined,
          })),
        },
        tx as never,
      );
      await tx.clientRefund.update({
        where: { id },
        data: { status: 'REVERSED', reversedBy: identity.userId, reversedAt: new Date(), reversalReason: input.reason.trim(), reversalJournalEntryId: result.journalEntryId },
      });
      await tx.paymentReceipt.update({ where: { id: refund.receiptId }, data: { unallocatedAmount: { increment: refund.amount } } });
      await this.audit(tx, identity, id, 'CLIENT_REFUND_REVERSED');
    });
    return this.view(identity, id);
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  private prisma(): TenantPrisma {
    return this.tenancyService.getClient() as unknown as TenantPrisma;
  }

  private async find(identity: RequestIdentity, id: string) {
    const row = await this.prisma().clientRefund.findFirst({ where: { id, organizationId: identity.activeOrganizationId } });
    if (!row) throw new NotFoundException({ errorCode: 'REFUND_NOT_FOUND', message: `Refund ${id} not found` });
    return row;
  }

  private async view(identity: RequestIdentity, id: string): Promise<ClientRefundView> {
    const prisma = this.prisma();
    const row = await prisma.clientRefund.findFirstOrThrow({
      where: { id, organizationId: identity.activeOrganizationId },
      include: { receipt: { select: { receiptNumber: true } } },
    });
    return (await this.views(prisma, [row]))[0]!;
  }

  private async unappliedAccount(prisma: TenantPrisma, orgId: string) {
    return this.resolver.resolveByCodeOrRole(prisma as never, orgId, undefined, 'UNAPPLIED_CLIENT_RECEIPTS');
  }

  /** Posts a refund (Dr Unapplied / Cr bank) and lowers what the receipt holds on account, under a row lock. */
  private async post(identity: RequestIdentity, id: string, approvedBy: string | null) {
    const prisma = this.prisma();
    const orgId = identity.activeOrganizationId;
    const refund = await this.find(identity, id);
    const bank = await prisma.bankAccount.findFirstOrThrow({ where: { id: refund.bankAccountId, organizationId: orgId } });
    const unapplied = await this.unappliedAccount(prisma, orgId);
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'CLIENT_REFUND', 'RF-');

    await prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ unallocated_amount: unknown; posting_status: string }>>`
        SELECT unallocated_amount, posting_status FROM payment_receipts WHERE id = ${refund.receiptId} AND organization_id = ${orgId} FOR UPDATE`;
      const onAccount = new Decimal(String(locked[0]?.unallocated_amount ?? '0'));
      const amount = new Decimal(refund.amount.toString());
      if (locked[0]?.posting_status !== 'POSTED' || amount.gt(onAccount)) {
        throw new BadRequestException({
          errorCode: 'REFUND_EXCEEDS_ON_ACCOUNT',
          message: `The receipt now holds ${onAccount.toFixed(2)} on account; the refund (${amount.toFixed(2)}) is more than that.`,
          details: { available: onAccount.toFixed(2) },
        });
      }
      const number = await this.sequenceRepo.claimNext(tx as never, orgId, 'CLIENT_REFUND');
      const result = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: refund.refundDate,
          documentDate: refund.refundDate,
          description: `Refund ${number.formattedNumber} to client`,
          currencyCode: bank.currencyCode,
          eventType: 'EVT-AR-011',
          sourceDocumentType: 'CLIENT_REFUND',
          sourceDocumentId: refund.id,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_CASH',
          createdBy: identity.userId,
          lines: [
            { accountId: unapplied.id, debitAmount: amount, creditAmount: new Decimal(0), clientId: refund.clientId },
            { accountId: bank.glAccountId, debitAmount: new Decimal(0), creditAmount: amount, clientId: refund.clientId },
          ],
        },
        tx as never,
      );
      await tx.clientRefund.update({
        where: { id },
        data: {
          status: 'POSTED',
          refundNumber: number.formattedNumber,
          postedJournalEntryId: result.journalEntryId,
          postedAt: new Date(),
          ...(approvedBy ? { approvedBy, approvedAt: new Date() } : {}),
        },
      });
      await tx.paymentReceipt.update({ where: { id: refund.receiptId }, data: { unallocatedAmount: { decrement: amount } } });
      await this.audit(tx, identity, id, approvedBy ? 'CLIENT_REFUND_APPROVED' : 'CLIENT_REFUND_POSTED');
    });
  }

  private async audit(tx: unknown, identity: RequestIdentity, id: string, eventType: string) {
    await this.auditOutbox?.record(tx as never, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: 'UPDATE',
      resourceType: 'ClientRefund',
      resourceId: id,
      sourceCommand: `accountsReceivable.${eventType}`,
      eventType,
      idempotencyKey: `${eventType}:${id}`,
    } as never);
  }

  private async views(
    prisma: TenantPrisma,
    rows: Array<Awaited<ReturnType<TenantPrisma['clientRefund']['findFirstOrThrow']>> & { receipt: { receiptNumber: string | null } }>,
  ): Promise<ClientRefundView[]> {
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.approvedBy].filter((x): x is string => Boolean(x))))];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }) : [];
    const name = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
    return rows.map((r) => ({
      id: r.id,
      receiptId: r.receiptId,
      receiptNumber: r.receipt.receiptNumber,
      bankAccountId: r.bankAccountId,
      refundNumber: r.refundNumber,
      amount: r.amount.toFixed(2),
      refundDate: r.refundDate.toISOString().slice(0, 10),
      reference: r.reference,
      reason: r.reason,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByName: name.get(r.requestedBy) ?? null,
      approvedByName: r.approvedBy ? (name.get(r.approvedBy) ?? null) : null,
      rejectionReason: r.rejectionReason,
      reversalReason: r.reversalReason,
    }));
  }
}
