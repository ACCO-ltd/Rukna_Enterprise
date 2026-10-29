import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, SupplierDebitNoteView } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommitmentLedgerWriter } from '../../../procurement/commitment-ledger/application/commitment-ledger-writer.service.js';
import { ACCOUNTING_POSTING_PORT, type IAccountingPostingPort } from '../../accounting-core/application/ports/accounting-posting.port.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { splitByWeight } from '../../accounts-receivable/application/credit-note.service.js';

type TenantPrisma = PrismaClient;

const AMOUNT = /^(?!0+(\.0+)?$)\d{1,15}(\.\d{1,2})?$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface RecordDebitNoteInput {
  billId: string;
  amount: string;
  accountingDate: string;
  reason: string;
  supplierReference?: string;
}

/**
 * AP-4 — a credit the supplier gives against a posted bill: goods sent back, an overcharge, a
 * discount agreed after the bill. EVT-AP-012: Dr Accounts payable / Cr the bill's own cost lines,
 * in proportion and with the bill's project and cost dimensions, so project cost falls where the
 * bill raised it. A purchase-order bill's ACTUAL cost in the commitment ledger falls the same way.
 *
 * It posts at once: it lowers what is owed and no money moves, so there is nothing for a second
 * person to release (the bill itself was approved). It is capped at what is still left to pay on
 * the bill — a credit on a bill already paid is money the supplier owes back, which is a refund.
 * Reversible (EVT-AP-013, the exact mirror); never deleted.
 */
@Injectable()
export class SupplierDebitNoteService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT) private readonly postingPort: IAccountingPostingPort,
    private readonly commitmentWriter: CommitmentLedgerWriter,
    @Optional() private readonly auditOutbox?: TransactionalAuditOutboxService,
  ) {}

  async listForBill(identity: RequestIdentity, billId: string): Promise<SupplierDebitNoteView[]> {
    const rows = await this.prisma().supplierDebitNote.findMany({
      where: { organizationId: identity.activeOrganizationId, supplierBillId: billId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(view);
  }

  async record(identity: RequestIdentity, input: RecordDebitNoteInput): Promise<SupplierDebitNoteView> {
    const prisma = this.prisma();
    const { activeOrganizationId: orgId, userId } = identity;
    if (!AMOUNT.test(input.amount ?? '')) {
      throw new BadRequestException({ errorCode: 'DEBIT_NOTE_AMOUNT_INVALID', message: 'Give a positive amount with at most two decimals.' });
    }
    if (!ISO_DATE.test(input.accountingDate ?? '')) {
      throw new BadRequestException({ errorCode: 'DEBIT_NOTE_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say what the credit is for.' });

    const bill = await prisma.supplierBill.findFirst({ where: { id: input.billId, organizationId: orgId } });
    if (!bill) throw new NotFoundException({ errorCode: 'BILL_NOT_FOUND', message: `Bill ${input.billId} not found` });
    if (bill.postingStatus !== 'POSTED' || !bill.postedJournalEntryId) {
      throw new BadRequestException({ errorCode: 'BILL_NOT_POSTED', message: 'A debit note goes against a posted bill.' });
    }
    const amount = new Decimal(input.amount);
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: bill.postedJournalEntryId }, include: { lines: true } });
    const apLine = original.lines.find((l) => l.sourceSubledgerType === 'ACCOUNTS_PAYABLE' && new Decimal(l.creditAmount.toString()).gt(0));
    const costLines = original.lines.filter((l) => new Decimal(l.debitAmount.toString()).gt(0));
    if (!apLine || costLines.length === 0) {
      throw new BadRequestException({ errorCode: 'BILL_JOURNAL_UNREADABLE', message: 'The bill’s journal has no payables or cost line to credit back.' });
    }
    const split = splitByWeight(amount, costLines.map((l) => ({ key: l.id, weight: new Decimal(l.debitAmount.toString()) })));
    const byLine = new Map(split.map((p) => [p.key, p.amount]));
    await this.sequenceRepo.ensureSequence(prisma as never, orgId, 'SUPPLIER_DEBIT_NOTE', 'DN-');
    const accountingDate = new Date(`${input.accountingDate}T00:00:00.000Z`);

    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ outstanding_amount: unknown; posting_status: string }>>`
        SELECT outstanding_amount, posting_status FROM supplier_bills WHERE id = ${bill.id} AND organization_id = ${orgId} FOR UPDATE`;
      if (locked[0]?.posting_status !== 'POSTED') throw new ConflictException('The bill changed a moment ago — reload it.');
      const left = new Decimal(String(locked[0].outstanding_amount));
      if (amount.gt(left)) {
        throw new BadRequestException({
          errorCode: 'DEBIT_NOTE_EXCEEDS_BALANCE',
          message: `The credit (${amount.toFixed(2)}) is more than is left to pay on the bill (${left.toFixed(2)}).`,
          details: { leftToPay: left.toFixed(2) },
        });
      }

      const note = await tx.supplierDebitNote.create({
        data: {
          organizationId: orgId,
          supplierId: bill.supplierId,
          supplierBillId: bill.id,
          supplierReference: input.supplierReference?.trim() || null,
          reason,
          accountingDate,
          amount,
          currencyCode: bill.currencyCode,
          createdBy: userId,
        },
      });
      const number = await this.sequenceRepo.claimNext(tx as never, orgId, 'SUPPLIER_DEBIT_NOTE');
      const dims = (l: (typeof original.lines)[number]) => ({
        projectId: l.projectId ?? undefined,
        departmentId: l.departmentId ?? undefined,
        costCenterId: l.costCenterId ?? undefined,
        supplierId: l.supplierId ?? bill.supplierId,
        boqNodeId: l.boqNodeId ?? undefined,
        spendCategoryId: l.spendCategoryId ?? undefined,
        taxCodeId: l.taxCodeId ?? undefined,
      });
      const posted = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate,
          documentDate: accountingDate,
          description: `Debit note ${number.formattedNumber} on ${bill.billNumber ?? bill.supplierInvoiceNumber}: ${reason}`,
          currencyCode: bill.currencyCode,
          eventType: 'EVT-AP-012',
          sourceDocumentType: 'SUPPLIER_DEBIT_NOTE',
          sourceDocumentId: note.id,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'NORMAL',
          postingOrigin: 'SYSTEM_AP',
          createdBy: userId,
          lines: [
            { accountId: apLine.accountId, debitAmount: amount, creditAmount: new Decimal(0), sourceSubledgerType: 'ACCOUNTS_PAYABLE', ...dims(apLine) },
            ...costLines
              .filter((l) => (byLine.get(l.id) ?? new Decimal(0)).gt(0))
              .map((l) => ({ accountId: l.accountId, debitAmount: new Decimal(0), creditAmount: byLine.get(l.id)!, ...dims(l) })),
          ],
        },
        tx as never,
      );
      const saved = await tx.supplierDebitNote.update({
        where: { id: note.id },
        data: { debitNoteNumber: number.formattedNumber, postedJournalEntryId: posted.journalEntryId },
      });
      await tx.supplierBill.update({ where: { id: bill.id }, data: { outstandingAmount: { decrement: amount } } });

      // The bill's ACTUAL cost (purchase-order bills) falls in proportion, on the same cost-targets.
      const actuals = await tx.commitmentLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocumentType: 'SUPPLIER_BILL', sourceDocumentId: bill.id, stage: 'ACTUAL' },
      });
      const actualSplit = splitByWeight(amount, actuals.map((e) => ({ key: e.id, weight: new Decimal(e.amount.toString()) })));
      for (const part of actualSplit) {
        const entry = actuals.find((e) => e.id === part.key)!;
        await this.commitmentWriter.actual(tx as never, {
          organizationId: orgId,
          projectId: entry.projectId ?? undefined,
          boqNodeId: entry.boqNodeId ?? undefined,
          spendCategoryId: entry.spendCategoryId ?? undefined,
          supplierId: entry.supplierId ?? undefined,
          purchaseOrderId: entry.purchaseOrderId ?? undefined,
          currencyCode: entry.currencyCode,
          amount: part.amount.negated(),
          sourceDocumentType: 'SUPPLIER_DEBIT_NOTE',
          sourceDocumentId: note.id,
          sourceLineId: entry.sourceLineId ?? undefined,
          eventType: 'DEBIT_NOTE_ACTUAL',
          idempotencyKey: `debit-note-${note.id}-${entry.id}`,
          accountingDate,
        });
      }
      await this.audit(tx, identity, saved.id, 'SUPPLIER_DEBIT_NOTE_POSTED', { amount: amount.toFixed(2), billId: bill.id, reason });
      return view(saved);
    });
  }

  async reverse(identity: RequestIdentity, noteId: string, input: { reversalDate: string; reason: string }): Promise<SupplierDebitNoteView> {
    const prisma = this.prisma();
    const { activeOrganizationId: orgId, userId } = identity;
    const note = await prisma.supplierDebitNote.findFirst({ where: { id: noteId, organizationId: orgId } });
    if (!note) throw new NotFoundException({ errorCode: 'DEBIT_NOTE_NOT_FOUND', message: `Debit note ${noteId} not found` });
    if (note.status !== 'POSTED' || !note.postedJournalEntryId) {
      throw new ConflictException({ errorCode: 'DEBIT_NOTE_NOT_POSTED', message: 'This debit note is already reversed.' });
    }
    const reason = (input.reason ?? '').trim();
    if (!reason) throw new BadRequestException({ errorCode: 'REASON_REQUIRED', message: 'Say why the debit note is reversed.' });
    if (!ISO_DATE.test(input.reversalDate ?? '')) {
      throw new BadRequestException({ errorCode: 'DEBIT_NOTE_DATE_INVALID', message: 'Give the date as YYYY-MM-DD.' });
    }
    const original = await prisma.journalEntry.findUniqueOrThrow({ where: { id: note.postedJournalEntryId }, include: { lines: true } });
    const reversalDate = new Date(`${input.reversalDate}T00:00:00.000Z`);

    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ posting_status: string }>>`
        SELECT posting_status FROM supplier_bills WHERE id = ${note.supplierBillId} AND organization_id = ${orgId} FOR UPDATE`;
      if (locked[0]?.posting_status !== 'POSTED') {
        throw new BadRequestException({ errorCode: 'BILL_NOT_POSTED', message: 'Only a debit note on a posted bill is reversed.' });
      }
      const { count } = await tx.supplierDebitNote.updateMany({
        where: { id: note.id, status: 'POSTED' },
        data: { status: 'REVERSED', reversedAt: new Date(), reversedBy: userId, reversalReason: reason },
      });
      if (count !== 1) throw new ConflictException({ errorCode: 'DEBIT_NOTE_NOT_POSTED', message: 'This debit note is already reversed.' });
      const posted = await this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: reversalDate,
          documentDate: reversalDate,
          description: `Reversal of debit note ${note.debitNoteNumber ?? note.id}: ${reason}`,
          currencyCode: original.currencyCode,
          eventType: 'EVT-AP-013',
          sourceDocumentType: 'SUPPLIER_DEBIT_NOTE',
          sourceDocumentId: `reversal-${note.id}`,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'REVERSAL',
          postingOrigin: 'SYSTEM_AP',
          reversalOfJournalEntryId: original.id,
          createdBy: userId,
          lines: original.lines.map((l) => ({
            accountId: l.accountId,
            debitAmount: new Decimal(l.creditAmount.toString()),
            creditAmount: new Decimal(l.debitAmount.toString()),
            sourceSubledgerType: l.sourceSubledgerType ?? undefined,
            projectId: l.projectId ?? undefined,
            departmentId: l.departmentId ?? undefined,
            costCenterId: l.costCenterId ?? undefined,
            supplierId: l.supplierId ?? undefined,
            boqNodeId: l.boqNodeId ?? undefined,
            spendCategoryId: l.spendCategoryId ?? undefined,
            taxCodeId: l.taxCodeId ?? undefined,
          })),
        },
        tx as never,
      );
      const saved = await tx.supplierDebitNote.update({ where: { id: note.id }, data: { reversalJournalEntryId: posted.journalEntryId } });
      await tx.supplierBill.update({ where: { id: note.supplierBillId }, data: { outstandingAmount: { increment: note.amount } } });

      const lowered = await tx.commitmentLedgerEntry.findMany({
        where: { organizationId: orgId, sourceDocumentType: 'SUPPLIER_DEBIT_NOTE', sourceDocumentId: note.id },
      });
      for (const entry of lowered) {
        await this.commitmentWriter.actual(tx as never, {
          organizationId: orgId,
          projectId: entry.projectId ?? undefined,
          boqNodeId: entry.boqNodeId ?? undefined,
          spendCategoryId: entry.spendCategoryId ?? undefined,
          supplierId: entry.supplierId ?? undefined,
          purchaseOrderId: entry.purchaseOrderId ?? undefined,
          currencyCode: entry.currencyCode,
          amount: new Decimal(entry.amount.toString()).negated(),
          sourceDocumentType: 'SUPPLIER_DEBIT_NOTE',
          sourceDocumentId: `reversal-${note.id}`,
          sourceLineId: entry.sourceLineId ?? undefined,
          eventType: 'DEBIT_NOTE_REVERSED_ACTUAL',
          idempotencyKey: `debit-note-reversal-${entry.id}`,
          accountingDate: reversalDate,
        });
      }
      await this.audit(tx, identity, note.id, 'SUPPLIER_DEBIT_NOTE_REVERSED', { reason });
      return view(saved);
    });
  }

  private async audit(tx: unknown, identity: RequestIdentity, id: string, eventType: string, after: Record<string, unknown>) {
    if (!this.auditOutbox) return;
    await this.auditOutbox.record(tx as never, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: eventType.endsWith('REVERSED') ? 'REVERSE' : 'POST',
      resourceType: 'SupplierDebitNote',
      resourceId: id,
      sourceCommand: eventType.endsWith('REVERSED') ? 'supplier-debit-note.reverse' : 'supplier-debit-note.record',
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
  id: string; supplierBillId: string; debitNoteNumber: string | null; supplierReference: string | null; reason: string;
  accountingDate: Date; amount: { toString(): string }; status: 'POSTED' | 'REVERSED'; createdBy: string; createdAt: Date;
  reversedAt: Date | null; reversalReason: string | null;
}): SupplierDebitNoteView {
  return {
    id: row.id,
    billId: row.supplierBillId,
    debitNoteNumber: row.debitNoteNumber,
    supplierReference: row.supplierReference,
    reason: row.reason,
    accountingDate: row.accountingDate.toISOString().slice(0, 10),
    amount: new Decimal(row.amount.toString()).toFixed(2),
    status: row.status,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    reversedAt: row.reversedAt ? row.reversedAt.toISOString() : null,
    reversalReason: row.reversalReason,
  };
}
