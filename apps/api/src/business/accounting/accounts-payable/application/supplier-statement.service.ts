import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, SupplierStatement, SupplierStatementLineKind } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ageOpenItems, buildStatementLines, type StatementMovement } from '../../accounting-core/domain/statement-of-account.js';
import { pendingPaymentHolds } from '../infrastructure/pending-payment-holds.repository.js';
import { SupplierStatementRepository } from '../infrastructure/supplier-statement.repository.js';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * AP-3 — a supplier's statement of account for a period: every bill, payment and buyer-cash
 * settlement (and each one's reversal) across all projects, with opening, running and closing
 * balances. The balance is what the organisation owes (credit-normal, like the AP account), so
 * today's closing balance equals what is owed on open bills less payments not yet applied —
 * the figure to agree with the statement the supplier sends.
 */
@Injectable()
export class SupplierStatementService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly repo: SupplierStatementRepository,
  ) {}

  async statement(identity: RequestIdentity, supplierId: string, fromIso?: string, toIso?: string): Promise<SupplierStatement> {
    const prisma = this.tenancyService.getClient() as unknown as PrismaClient;
    const orgId = identity.activeOrganizationId;
    const today = new Date().toISOString().slice(0, 10);
    const to = toIso ?? today;
    const from = fromIso ?? `${to.slice(0, 4)}-01-01`;
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || from > to) {
      throw new BadRequestException({ errorCode: 'STATEMENT_PERIOD_INVALID', message: 'Give a period as from ≤ to, both YYYY-MM-DD.' });
    }

    const supplier = await this.repo.findSupplier(prisma, orgId, supplierId);
    if (!supplier) throw new NotFoundException({ errorCode: 'SUPPLIER_NOT_FOUND', message: `Supplier ${supplierId} not found` });

    const [bills, payments, buyerCash, pending] = await Promise.all([
      this.repo.findBills(prisma, orgId, supplierId),
      this.repo.findPayments(prisma, orgId, supplierId),
      this.repo.findBuyerCash(prisma, orgId, supplierId),
      this.repo.pendingPaymentsTotal(prisma, orgId, supplierId),
    ]);
    const [journalDates, paymentReversals, holds] = await Promise.all([
      this.repo.journalDates(prisma, [...bills.map((b) => b.reversalJournalEntryId), ...buyerCash.map((c) => c.reversalJournalEntryId)].filter((id): id is string => Boolean(id))),
      this.repo.paymentReversalDates(prisma, orgId, payments.filter((p) => p.postingStatus === 'REVERSED').map((p) => p.id)),
      pendingPaymentHolds(prisma, orgId, bills.map((b) => b.id)),
    ]);
    const reversalDate = (journalId: string | null, fallback: Date | null) =>
      (journalId ? journalDates.get(journalId) : undefined) ?? fallback ?? null;

    const zero = new Decimal(0);
    const movements: StatementMovement<SupplierStatementLineKind>[] = [];
    for (const bill of bills) {
      const amount = new Decimal(bill.totalAmount.toString());
      const reference = bill.billNumber ?? bill.supplierInvoiceNumber;
      const description = bill.supplierInvoiceNumber;
      movements.push({ date: bill.billDate, kind: 'BILL', documentId: bill.id, reference, description, debit: zero, credit: amount, sequence: 0 });
      if (bill.postingStatus === 'REVERSED') {
        const date = reversalDate(bill.reversalJournalEntryId, bill.reversedAt);
        if (date) movements.push({ date, kind: 'BILL_REVERSAL', documentId: bill.id, reference, description, debit: amount, credit: zero, sequence: 1 });
      }
    }
    for (const p of payments) {
      const amount = new Decimal(p.totalAmount.toString());
      movements.push({ date: p.accountingDate, kind: 'PAYMENT', documentId: p.id, reference: p.paymentNumber, description: p.bankReference, debit: amount, credit: zero, sequence: 2 });
      if (p.postingStatus === 'REVERSED') {
        const date = paymentReversals.get(p.id) ?? p.updatedAt;
        movements.push({ date, kind: 'PAYMENT_REVERSAL', documentId: p.id, reference: p.paymentNumber, description: p.bankReference, debit: zero, credit: amount, sequence: 3 });
      }
    }
    for (const c of buyerCash) {
      const amount = new Decimal(c.allocatedAmount.toString());
      const bill = c.supplierBill.billNumber ?? c.supplierBill.supplierInvoiceNumber;
      const date = c.allocationDate ?? c.createdAt;
      movements.push({ date, kind: 'BUYER_CASH', documentId: c.supplierBillId, reference: bill, description: bill, debit: amount, credit: zero, sequence: 4 });
      if (c.postingStatus === 'REVERSED') {
        const back = reversalDate(c.reversalJournalEntryId, c.reversedAt);
        if (back) movements.push({ date: back, kind: 'BUYER_CASH_REVERSAL', documentId: c.supplierBillId, reference: bill, description: bill, debit: zero, credit: amount, sequence: 5 });
      }
    }

    const placed = buildStatementLines(movements, new Date(`${from}T00:00:00.000Z`), new Date(`${to}T00:00:00.000Z`), { creditNormal: true });
    const openBills = bills.filter((b) => b.postingStatus !== 'REVERSED' && b.documentStatus !== 'CANCELLED' && b.documentStatus !== 'REJECTED');
    const unapplied = payments
      .filter((p) => p.postingStatus !== 'REVERSED')
      .reduce((sum, p) => sum.plus(p.unallocatedAmount.toString()), new Decimal(0));

    return {
      supplier: { id: supplier.id, name: supplier.name, code: supplier.code },
      from,
      to,
      openingBalance: placed.opening.toFixed(2),
      lines: placed.lines,
      totals: { debits: placed.debits.toFixed(2), credits: placed.credits.toFixed(2) },
      closingBalance: placed.closing.toFixed(2),
      aging: ageOpenItems(
        openBills.map((b) => ({ dueDate: b.dueDate, outstanding: new Decimal(b.outstandingAmount.toString()).plus(holds.get(b.id) ?? zero) })),
        new Date(`${today}T00:00:00.000Z`),
      ),
      unapplied: unapplied.toFixed(2),
      pendingPayments: new Decimal(pending?.toString() ?? '0').toFixed(2),
    };
  }
}
