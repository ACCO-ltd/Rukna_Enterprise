import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { BankTransfer, PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { BankTransferView, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ACCOUNTING_POSTING_PORT, type IAccountingPostingPort } from './ports/accounting-posting.port.js';
import { AccountingConfigurationService } from './accounting-configuration.service.js';
import { DocumentSequenceRepository } from '../infrastructure/document-sequence.repository.js';
import { DEFAULT_APPROVAL_SETTINGS, paymentApprovedOnSave } from '../domain/approval-settings.js';

type TenantPrisma = PrismaClient;

const AMOUNT = /^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RequestTransferInput {
  fromBankAccountId: string;
  toBankAccountId: string;
  amount: string;
  transferDate: string;
  reference?: string;
  memo?: string;
}

/**
 * B-2 — moving money between two of the organisation's own accounts: a bank to a cash box, an
 * EVC float top-up, one bank to another. EVT-CB-001: Dr the receiving account's GL / Cr the sending
 * account's GL, both on the BANK subledger. Money leaves an account, so it follows the payment
 * rule (ADR-046 §4): up to the payment limit (`paymentAutoApproveUpTo`) it posts at once; above
 * it, it waits in Approvals for someone other than the person who asked. A posted transfer can be
 * reversed (EVT-CB-002, the mirror). Nothing is deleted.
 */
@Injectable()
export class BankTransferService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort: IAccountingPostingPort,
    @Optional() private readonly accountingConfig?: AccountingConfigurationService,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async list(identity: RequestIdentity, bankAccountId?: string): Promise<BankTransferView[]> {
    const rows = await this.prisma().bankTransfer.findMany({
      where: {
        organizationId: identity.activeOrganizationId,
        ...(bankAccountId ? { OR: [{ fromBankAccountId: bankAccountId }, { toBankAccountId: bankAccountId }] } : {}),
      },
      orderBy: [{ transferDate: 'desc' }, { requestedAt: 'desc' }],
      take: 500,
    });
    return this.views(rows);
  }

  async request(identity: RequestIdentity, input: RequestTransferInput): Promise<BankTransferView> {
    const prisma = this.prisma();
    const orgId = identity.activeOrganizationId;
    if (!AMOUNT.test(input.amount ?? '')) {
      throw new BadRequestException({ errorCode: 'TRANSFER_AMOUNT_INVALID', message: 'Give a positive amount with at most two decimals.' });
    }
    if (!ISO_DATE.test(input.transferDate ?? '')) {
      throw new BadRequestException({ errorCode: 'TRANSFER_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    if (input.fromBankAccountId === input.toBankAccountId) {
      throw new BadRequestException({ errorCode: 'TRANSFER_SAME_ACCOUNT', message: 'Choose two different accounts.' });
    }
    const { from, to } = await this.accounts(prisma, orgId, input.fromBankAccountId, input.toBankAccountId);
    const amount = new Decimal(input.amount);
    const settings = (await this.accountingConfig?.getApprovalSettings(orgId)) ?? DEFAULT_APPROVAL_SETTINGS;
    const created = await prisma.bankTransfer.create({
      data: {
        organizationId: orgId,
        fromBankAccountId: from.id,
        toBankAccountId: to.id,
        amount,
        currencyCode: from.currencyCode,
        transferDate: new Date(`${input.transferDate}T00:00:00.000Z`),
        reference: input.reference?.trim() || null,
        memo: input.memo?.trim() || null,
        requestedBy: identity.userId,
      },
    });
    if (!paymentApprovedOnSave(settings, amount)) return this.view(identity, created.id);
    try {
      await this.post(identity, created.id, null);
    } catch (error) {
      // Nothing half-done is kept: a transfer that could not post at once was never made.
      await prisma.bankTransfer.delete({ where: { id: created.id } });
      throw error;
    }
    return this.view(identity, created.id);
  }

  async approve(identity: RequestIdentity, id: string): Promise<BankTransferView> {
    const transfer = await this.find(identity, id);
    if (transfer.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({ errorCode: 'TRANSFER_NOT_PENDING', message: 'This transfer is not waiting for approval.' });
    }
    if (transfer.requestedBy === identity.userId) {
      throw new ForbiddenException({ errorCode: 'TRANSFER_SELF_APPROVAL', message: 'Someone other than the person who asked must approve a transfer.' });
    }
    await this.post(identity, id, identity.userId);
    return this.view(identity, id);
  }

  async reject(identity: RequestIdentity, id: string, reason: string): Promise<BankTransferView> {
    const transfer = await this.find(identity, id);
    if (transfer.status !== 'PENDING_APPROVAL') {
      throw new ConflictException({ errorCode: 'TRANSFER_NOT_PENDING', message: 'This transfer is not waiting for approval.' });
    }
    const why = (reason ?? '').trim();
    if (!why) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the transfer is rejected.' });
    const { count } = await this.prisma().bankTransfer.updateMany({
      where: { id, status: 'PENDING_APPROVAL' },
      data: { status: 'REJECTED', rejectedBy: identity.userId, rejectedAt: new Date(), rejectionReason: why },
    });
    if (count !== 1) throw new ConflictException({ errorCode: 'TRANSFER_NOT_PENDING', message: 'This transfer changed a moment ago — reload it.' });
    return this.view(identity, id);
  }

  /** A transfer recorded in error (the money never moved): the mirror journal. */
  async reverse(identity: RequestIdentity, id: string, input: { reversalDate: string; reason: string }): Promise<BankTransferView> {
    const prisma = this.prisma();
    const transfer = await this.find(identity, id);
    if (transfer.status !== 'POSTED' || !transfer.postedJournalEntryId) {
      throw new ConflictException({ errorCode: 'TRANSFER_NOT_POSTED', message: 'Only a posted transfer can be reversed.' });
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the transfer is reversed.' });
    if (!ISO_DATE.test(input.reversalDate ?? '')) {
      throw new BadRequestException({ errorCode: 'TRANSFER_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: transfer.postedJournalEntryId }, include: { lines: true } });
    const reversalDate = new Date(`${input.reversalDate}T00:00:00.000Z`);
    await prisma.$transaction(async (tx) => {
      const { count } = await tx.bankTransfer.updateMany({
        where: { id, status: 'POSTED' },
        data: { status: 'REVERSED', reversedBy: identity.userId, reversedAt: new Date(), reversalReason: reason },
      });
      if (count !== 1) throw new ConflictException({ errorCode: 'TRANSFER_NOT_POSTED', message: 'This transfer is already reversed.' });
      const result = await this.postingPort.post(
        {
          organizationId: identity.activeOrganizationId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of transfer ${transfer.transferNumber}: ${reason}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-CB-002',
          sourceDocumentType: 'BANK_TRANSFER',
          sourceDocumentId: `reversal-${transfer.id}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: original.id,
          createdBy: identity.userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: new Decimal(l.creditAmount.toString()),
            creditAmount: new Decimal(l.debitAmount.toString()),
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
          })),
        },
        tx as never,
      );
      await tx.bankTransfer.update({ where: { id }, data: { reversalJournalEntryId: result.journalEntryId } });
      await this.audit(tx, identity, id, 'BANK_TRANSFER_REVERSED');
    });
    return this.view(identity, id);
  }

  // ─── internals ──────────────────────────────────────────────────────────────

  /** Both accounts open, the sender paying out and the receiver taking money in, in one currency. */
  private async accounts(prisma: TenantPrisma, orgId: string, fromId: string, toId: string) {
    const [from, to] = await Promise.all([
      prisma.bankAccount.findFirst({ where: { id: fromId, organizationId: orgId } }),
      prisma.bankAccount.findFirst({ where: { id: toId, organizationId: orgId } }),
    ]);
    if (!from || !to) throw new NotFoundException({ errorCode: 'BANK_ACCOUNT_NOT_FOUND', message: 'Bank account not found.' });
    if (from.status !== 'ACTIVE' || !from.allowsPayments) {
      throw new BadRequestException({ errorCode: 'BANK_ACCOUNT_NOT_PAYING', message: `${from.accountName} is not open for payments.` });
    }
    if (to.status !== 'ACTIVE' || !to.allowsReceipts) {
      throw new BadRequestException({ errorCode: 'BANK_ACCOUNT_NOT_RECEIVING', message: `${to.accountName} does not take money in.` });
    }
    if (from.currencyCode !== to.currencyCode) {
      throw new BadRequestException({ errorCode: 'CURRENCY_MISMATCH', message: 'The two accounts are in different currencies.' });
    }
    return { from, to };
  }

  /** Posts a transfer: Dr receiving GL / Cr sending GL. The accounts are re-checked at posting. */
  private async post(identity: RequestIdentity, id: string, approvedBy: string | null) {
    const prisma = this.prisma();
    const orgId = identity.activeOrganizationId;
    const transfer = await this.find(identity, id);
    const { from, to } = await this.accounts(prisma, orgId, transfer.fromBankAccountId, transfer.toBankAccountId);
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'BANK_TRANSFER', 'TR-');
    const amount = new Decimal(transfer.amount.toString());

    await prisma.$transaction(async (tx) => {
      const number = await this.sequenceRepo.claimNext(tx as never, orgId, 'BANK_TRANSFER');
      const result = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: transfer.transferDate,
          documentDate: transfer.transferDate,
          description: `Transfer ${number.formattedNumber}: ${from.accountName} → ${to.accountName}${transfer.memo ? ` — ${transfer.memo}` : ''}`,
          currencyCode: from.currencyCode,
          eventType: 'EVT-CB-001',
          sourceDocumentType: 'BANK_TRANSFER',
          sourceDocumentId: transfer.id,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_CASH',
          createdBy: identity.userId,
          lines: [
            { accountId: to.glAccountId, debitAmount: amount, creditAmount: new Decimal(0), sourceSubledgerType: 'BANK' },
            { accountId: from.glAccountId, debitAmount: new Decimal(0), creditAmount: amount, sourceSubledgerType: 'BANK' },
          ],
        },
        tx as never,
      );
      const { count } = await tx.bankTransfer.updateMany({
        where: { id, status: 'PENDING_APPROVAL' },
        data: {
          status: 'POSTED',
          transferNumber: number.formattedNumber,
          postedJournalEntryId: result.journalEntryId,
          postedAt: new Date(),
          ...(approvedBy ? { approvedBy, approvedAt: new Date() } : {}),
        },
      });
      if (count !== 1) throw new ConflictException({ errorCode: 'TRANSFER_NOT_PENDING', message: 'This transfer changed a moment ago — reload it.' });
      await this.audit(tx, identity, id, approvedBy ? 'BANK_TRANSFER_APPROVED' : 'BANK_TRANSFER_POSTED');
    });
  }

  private prisma(): TenantPrisma {
    return this.tenancyService.getClient() as unknown as TenantPrisma;
  }

  private async find(identity: RequestIdentity, id: string) {
    const row = await this.prisma().bankTransfer.findFirst({ where: { id, organizationId: identity.activeOrganizationId } });
    if (!row) throw new NotFoundException({ errorCode: 'TRANSFER_NOT_FOUND', message: `Transfer ${id} not found` });
    return row;
  }

  private async view(identity: RequestIdentity, id: string): Promise<BankTransferView> {
    return (await this.views([await this.find(identity, id)]))[0]!;
  }

  private async audit(tx: unknown, identity: RequestIdentity, id: string, eventType: string) {
    await this.auditOutbox?.record(tx as never, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: 'UPDATE',
      resourceType: 'BankTransfer',
      resourceId: id,
      sourceCommand: `banking.${eventType}`,
      eventType,
      idempotencyKey: `${eventType}:${id}`,
    } as never);
  }

  private async views(rows: BankTransfer[]): Promise<BankTransferView[]> {
    const prisma = this.prisma();
    const accountIds = [...new Set(rows.flatMap((r) => [r.fromBankAccountId, r.toBankAccountId]))];
    const userIds = [...new Set(rows.flatMap((r) => [r.requestedBy, r.approvedBy].filter((x): x is string => Boolean(x))))];
    const [accounts, users] = await Promise.all([
      prisma.bankAccount.findMany({ where: { id: { in: accountIds } }, select: { id: true, accountName: true } }),
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const accountName = new Map<string, string>(accounts.map((a) => [a.id, a.accountName] as const));
    const name = new Map<string, string>(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()] as const));
    return rows.map((r) => ({
      id: r.id,
      transferNumber: r.transferNumber,
      fromBankAccountId: r.fromBankAccountId,
      fromAccountName: accountName.get(r.fromBankAccountId) ?? '—',
      toBankAccountId: r.toBankAccountId,
      toAccountName: accountName.get(r.toBankAccountId) ?? '—',
      amount: new Decimal(r.amount.toString()).toFixed(2),
      currencyCode: r.currencyCode,
      transferDate: r.transferDate.toISOString().slice(0, 10),
      reference: r.reference,
      memo: r.memo,
      status: r.status,
      requestedBy: r.requestedBy,
      requestedByName: name.get(r.requestedBy) ?? null,
      approvedByName: r.approvedBy ? (name.get(r.approvedBy) ?? null) : null,
      rejectionReason: r.rejectionReason,
      reversalReason: r.reversalReason,
    }));
  }
}
