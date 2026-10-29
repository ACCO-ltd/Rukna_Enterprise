import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, SupplierRefundView } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ACCOUNTING_POSTING_PORT, type IAccountingPostingPort } from '../../accounting-core/application/ports/accounting-posting.port.js';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';

type TenantPrisma = PrismaClient;

const AMOUNT = /^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RecordSupplierRefundInput {
  paymentId: string;
  bankAccountId: string;
  amount: string;
  refundDate: string;
  reason: string;
  reference?: string;
}

/**
 * AP-5 — a supplier pays back money paid ahead: the unapplied part of a posted payment, which the
 * ledger holds as a supplier advance (an order cancelled, an overpayment). EVT-AP-014: Dr the
 * receiving bank's GL / Cr Supplier advance — the account the payment debited — tagged with the
 * supplier; the payment holds that much less unapplied.
 *
 * Money comes in, so it posts at once (nothing for a second person to release). Capped at what
 * the payment still holds unapplied. Reversible (EVT-AP-015, e.g. the supplier's transfer bounced);
 * a payment with a posted refund cannot itself be reversed until the refund is.
 */
@Injectable()
export class SupplierRefundService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    private readonly resolver: PostingAccountResolver,
    @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort: IAccountingPostingPort,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async listForPayment(identity: RequestIdentity, paymentId: string): Promise<SupplierRefundView[]> {
    const rows = await this.prisma().supplierRefund.findMany({
      where: { organizationId: identity.activeOrganizationId, supplierPaymentId: paymentId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(view);
  }

  async record(identity: RequestIdentity, input: RecordSupplierRefundInput): Promise<SupplierRefundView> {
    const prisma = this.prisma();
    const { activeOrganizationId: orgId, userId } = identity;
    if (!AMOUNT.test(input.amount ?? '')) {
      throw new BadRequestException({ errorCode: 'REFUND_AMOUNT_INVALID', message: 'Give a positive amount with at most two decimals.' });
    }
    if (!ISO_DATE.test(input.refundDate ?? '')) {
      throw new BadRequestException({ errorCode: 'REFUND_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the supplier paid this back.' });

    const payment = await prisma.supplierPayment.findFirst({ where: { id: input.paymentId, organizationId: orgId } });
    if (!payment) throw new NotFoundException({ errorCode: 'PAYMENT_NOT_FOUND', message: `Payment ${input.paymentId} not found` });
    if (payment.postingStatus !== 'POSTED' || !payment.postedJournalEntryId) {
      throw new BadRequestException({ errorCode: 'PAYMENT_NOT_POSTED', message: 'Only money from a posted payment can be paid back.' });
    }
    const bank = await prisma.bankAccount.findFirst({
      where: { id: input.bankAccountId, organizationId: orgId },
      select: { id: true, status: true, allowsReceipts: true, currencyCode: true, glAccountId: true },
    });
    if (!bank) throw new NotFoundException({ errorCode: 'BANK_ACCOUNT_NOT_FOUND', message: 'Bank account not found.' });
    if (bank.status !== 'ACTIVE' || !bank.allowsReceipts) {
      throw new BadRequestException({ errorCode: 'BANK_ACCOUNT_CANNOT_RECEIVE', message: 'That bank account does not take money in.' });
    }
    if (bank.currencyCode !== payment.currencyCode) {
      throw new BadRequestException({ errorCode: 'CURRENCY_MISMATCH', message: 'The bank account is in a different currency from the payment.' });
    }

    // The account the payment parked the unapplied money on: its own debit line other than AP.
    const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: payment.postedJournalEntryId }, include: { lines: true } });
    const advanceLine = journal.lines.find((l) => l.sourceSubledgerType !== 'ACCOUNTS_PAYABLE' && new Decimal(l.debitAmount.toString()).gt(0));
    const advanceAccountId = advanceLine?.accountId ?? (await this.resolver.resolve(prisma as never, orgId, 'SUPPLIER_ADVANCE')).id;

    const amount = new Decimal(input.amount);
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'SUPPLIER_REFUND', 'SR-');
    const refundDate = new Date(`${input.refundDate}T00:00:00.000Z`);

    return prisma.$transaction(async (tx) => {
      // Guarded: the payment must still hold this much unapplied (an allocation or another refund
      // a moment ago may have used it).
      const { count } = await tx.supplierPayment.updateMany({
        where: { id: payment.id, postingStatus: 'POSTED', unallocatedAmount: { gte: amount } },
        data: { unallocatedAmount: { decrement: amount } },
      });
      if (count !== 1) {
        const now = await tx.supplierPayment.findUniqueOrThrow({ where: { id: payment.id }, select: { unallocatedAmount: true } });
        throw new BadRequestException({
          errorCode: 'REFUND_EXCEEDS_UNAPPLIED',
          message: `The refund (${amount.toFixed(2)}) is more than the payment holds unapplied (${new Decimal(now.unallocatedAmount.toString()).toFixed(2)}).`,
          details: { unapplied: new Decimal(now.unallocatedAmount.toString()).toFixed(2) },
        });
      }
      const refund = await tx.supplierRefund.create({
        data: {
          organizationId: orgId,
          supplierId: payment.supplierId,
          supplierPaymentId: payment.id,
          bankAccountId: bank.id,
          refundDate,
          amount,
          currencyCode: payment.currencyCode,
          reference: input.reference?.trim() || null,
          reason,
          createdBy: userId,
        },
      });
      const number = await this.sequenceRepo.claimNext(tx as never, orgId, 'SUPPLIER_REFUND');
      const posted = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: refundDate,
          documentDate: refundDate,
          description: `Supplier refund ${number.formattedNumber} of ${payment.paymentNumber ?? 'payment'}: ${reason}`,
          currencyCode: payment.currencyCode,
          eventType: 'EVT-AP-014',
          sourceDocumentType: 'SUPPLIER_REFUND',
          sourceDocumentId: refund.id,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_CASH',
          createdBy: userId,
          lines: [
            { accountId: bank.glAccountId, debitAmount: amount, creditAmount: new Decimal(0), sourceSubledgerType: 'BANK', supplierId: payment.supplierId },
            { accountId: advanceAccountId, debitAmount: new Decimal(0), creditAmount: amount, supplierId: payment.supplierId },
          ],
        },
        tx as never,
      );
      const saved = await tx.supplierRefund.update({
        where: { id: refund.id },
        data: { refundNumber: number.formattedNumber, postedJournalEntryId: posted.journalEntryId },
      });
      await this.audit(tx, identity, saved.id, 'SUPPLIER_REFUND_POSTED', { amount: amount.toFixed(2), paymentId: payment.id, reason });
      return view(saved);
    });
  }

  async reverse(identity: RequestIdentity, refundId: string, input: { reversalDate: string; reason: string }): Promise<SupplierRefundView> {
    const prisma = this.prisma();
    const { activeOrganizationId: orgId, userId } = identity;
    const refund = await prisma.supplierRefund.findFirst({ where: { id: refundId, organizationId: orgId } });
    if (!refund) throw new NotFoundException({ errorCode: 'REFUND_NOT_FOUND', message: `Refund ${refundId} not found` });
    if (refund.status !== 'POSTED' || !refund.postedJournalEntryId) {
      throw new ConflictException({ errorCode: 'REFUND_NOT_POSTED', message: 'This refund is already reversed.' });
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the refund is reversed.' });
    if (!ISO_DATE.test(input.reversalDate ?? '')) {
      throw new BadRequestException({ errorCode: 'REFUND_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: refund.postedJournalEntryId }, include: { lines: true } });
    const reversalDate = new Date(`${input.reversalDate}T00:00:00.000Z`);

    return prisma.$transaction(async (tx) => {
      const { count } = await tx.supplierRefund.updateMany({
        where: { id: refund.id, status: 'POSTED' },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, reversalReason: reason },
      });
      if (count !== 1) throw new ConflictException({ errorCode: 'REFUND_NOT_POSTED', message: 'This refund is already reversed.' });
      const posted = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of supplier refund ${refund.refundNumber ?? refund.id}: ${reason}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-AP-015',
          sourceDocumentType: 'SUPPLIER_REFUND',
          sourceDocumentId: `reversal-${refund.id}`,
          journalCategory: 'CASH_AND_BANK',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_CASH',
          reversalOfJournalEntryId: original.id,
          createdBy: userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: new Decimal(l.creditAmount.toString()),
            creditAmount: new Decimal(l.debitAmount.toString()),
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            supplierId: l.supplierId ?? undefined,
          })),
        },
        tx as never,
      );
      const saved = await tx.supplierRefund.update({ where: { id: refund.id }, data: { reversalJournalEntryId: posted.journalEntryId } });
      // The money is held unapplied on the payment again.
      await tx.supplierPayment.update({ where: { id: refund.supplierPaymentId }, data: { unallocatedAmount: { increment: refund.amount } } });
      await this.audit(tx, identity, refund.id, 'SUPPLIER_REFUND_REVERSED', { reason });
      return view(saved);
    });
  }

  private async audit(tx: unknown, identity: RequestIdentity, id: string, eventType: string, after: Record<string, unknown>) {
    if (!this.auditOutbox) return;
    await this.auditOutbox.record(tx as never, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: eventType.endsWith('REVERSED') ? 'REVERSE' : 'POST',
      resourceType: 'SupplierRefund',
      resourceId: id,
      sourceCommand: eventType.endsWith('REVERSED') ? 'supplier-refund.reverse' : 'supplier-refund.record',
      eventType,
      idempotencyKey: `${eventType}-${id}`,
      after,
    });
  }

  private prisma(): TenantPrisma {
    return this.tenancyService.getClient() as unknown as TenantPrisma;
  }
}

function view(row: {
  id: string; supplierPaymentId: string; bankAccountId: string; refundNumber: string | null; refundDate: Date; amount: { toString(): string };
  reference: string | null; reason: string; status: 'POSTED' | 'REVERSED'; createdBy: string; createdAt: Date; reversedAt: Date | null; reversalReason: string | null;
}): SupplierRefundView {
  return {
    id: row.id,
    paymentId: row.supplierPaymentId,
    bankAccountId: row.bankAccountId,
    refundNumber: row.refundNumber,
    refundDate: row.refundDate.toISOString().slice(0, 10),
    amount: new Decimal(row.amount.toString()).toFixed(2),
    reference: row.reference,
    reason: row.reason,
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    reversalReason: row.reversalReason,
  };
}
