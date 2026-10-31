import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Read-only figures for Finance Home (Step 4). Every query is org-scoped and reads only what is in
 * the ledger: posted invoices, bills, receipts and payments, and posted journal lines on the bank
 * accounts' GL accounts.
 */
@Injectable()
export class FinanceHomeRepository {
  bankAccounts(prisma: TenantPrisma, organizationId: string) {
    return prisma.bankAccount.findMany({
      where: { organizationId, status: { not: 'CLOSED' } },
      orderBy: { bankName: 'asc' },
      select: { id: true, bankName: true, accountName: true, glAccountId: true },
    });
  }

  /** Σ debit − Σ credit per GL account over posted journals. */
  async glBalances(prisma: TenantPrisma, organizationId: string, accountIds: string[]) {
    if (accountIds.length === 0) return [];
    return prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { accountId: { in: accountIds }, entry: { organizationId, status: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
  }

  /** Issued invoices still owed (posted or carried in as opening balances). */
  openInvoices(prisma: TenantPrisma, organizationId: string) {
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] },
        documentStatus: { not: 'CANCELLED' },
        outstandingAmount: { gt: 0 },
      },
      select: { clientId: true, dueDate: true, invoiceDate: true, outstandingAmount: true, client: { select: { name: true } } },
    });
  }

  openBills(prisma: TenantPrisma, organizationId: string) {
    return prisma.supplierBill.findMany({
      where: {
        organizationId,
        postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] },
        documentStatus: { notIn: ['CANCELLED', 'REJECTED'] },
        outstandingAmount: { gt: 0 },
      },
      select: { dueDate: true, outstandingAmount: true },
    });
  }

  /** Step 6 — every open invoice with its client, for the receivables aging report. */
  agingInvoices(prisma: TenantPrisma, organizationId: string) {
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] },
        documentStatus: { not: 'CANCELLED' },
        outstandingAmount: { gt: 0 },
      },
      select: {
        id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, outstandingAmount: true, postingStatus: true,
        client: { select: { id: true, code: true, name: true } },
      },
    });
  }

  /**
   * AG — everything the receivables aging is drawn from: every invoice that reached the book, the
   * movements against them (payments applied, credit notes, write-offs), every receipt with its
   * refunds, and the dates of the journals that reversed any of them.
   */
  async receivablesBook(prisma: TenantPrisma, organizationId: string) {
    const live = { in: ['POSTED', 'REVERSED', 'OPENING_BALANCE'] as ('POSTED' | 'REVERSED' | 'OPENING_BALANCE')[] };
    const [invoices, allocations, creditNotes, writeOffs, receipts, refunds] = await Promise.all([
      prisma.clientInvoice.findMany({
        where: { organizationId, postingStatus: live, documentStatus: { not: 'CANCELLED' } },
        select: {
          id: true, invoiceNumber: true, invoiceDate: true, dueDate: true, totalAmount: true, outstandingAmount: true,
          postingStatus: true, reversalJournalEntryId: true, reversedAt: true, retentionAmount: true, retentionReleasedAmount: true,
          client: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.clientReceiptAllocation.findMany({
        where: { organizationId, postingStatus: { in: ['POSTED', 'REVERSED'] } },
        select: { clientInvoiceId: true, paymentReceiptId: true, allocatedAmount: true, allocationDate: true, postingStatus: true, reversalJournalEntryId: true },
      }),
      prisma.creditNote.findMany({
        where: { organizationId, postingStatus: { in: ['POSTED', 'REVERSED'] } },
        select: { invoiceId: true, totalAmount: true, accountingDate: true, postingStatus: true, reversalJournalEntryId: true, reversedAt: true },
      }),
      prisma.receivableWriteOff.findMany({
        where: { organizationId, status: { in: ['POSTED', 'REVERSED'] } },
        select: { invoiceId: true, amount: true, accountingDate: true, status: true, reversalJournalEntryId: true, reversedAt: true },
      }),
      prisma.paymentReceipt.findMany({
        where: { organizationId, postingStatus: live },
        select: {
          id: true, totalAmount: true, unallocatedAmount: true, accountingDate: true, postingStatus: true, reversalJournalEntryId: true, reversedAt: true,
          client: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.clientRefund.findMany({
        where: { organizationId, status: { in: ['POSTED', 'REVERSED'] } },
        select: { receiptId: true, amount: true, refundDate: true, status: true, reversalJournalEntryId: true, reversedAt: true },
      }),
    ]);
    const reversalIds = [...invoices, ...allocations, ...creditNotes, ...writeOffs, ...receipts, ...refunds]
      .map((r) => r.reversalJournalEntryId)
      .filter((id): id is string => Boolean(id));
    const journals = reversalIds.length
      ? await prisma.journalEntry.findMany({ where: { id: { in: reversalIds } }, select: { id: true, accountingDate: true } })
      : [];
    return { invoices, allocations, creditNotes, writeOffs, receipts, refunds, journalDates: new Map(journals.map((j) => [j.id, j.accountingDate])) };
  }

  /**
   * AG-4 — a control account's balance at the end of a day, from the ledger: every posted line on
   * the accounts of that subtype (debit − credit). Reversals are journals of their own, so they
   * count on their own dates.
   */
  async controlBalance(prisma: TenantPrisma, organizationId: string, subtype: 'ACCOUNTS_RECEIVABLE' | 'ACCOUNTS_PAYABLE', asOf: Date) {
    const accounts = await prisma.account.findMany({
      where: { organizationId, versions: { some: { accountSubtype: subtype } } },
      select: { id: true },
    });
    if (accounts.length === 0) return null;
    const sum = await prisma.journalLine.aggregate({
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        entry: { organizationId, status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { lte: asOf } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return { debit: sum._sum.debitAmount, credit: sum._sum.creditAmount };
  }

  /**
   * AA — everything the payables aging is drawn from, so it can be rebuilt as of a past day: every
   * bill that reached the book, the movements that settled them (payments applied, debit notes,
   * buyer cash applied), every posted payment with its refunds (money held as an advance), and the
   * dates of the journals behind them.
   */
  async payablesBook(prisma: TenantPrisma, organizationId: string) {
    const live = { in: ['POSTED', 'REVERSED', 'OPENING_BALANCE'] as ('POSTED' | 'REVERSED' | 'OPENING_BALANCE')[] };
    const [bills, allocations, debitNotes, buyerCash, payments, refunds] = await Promise.all([
      prisma.supplierBill.findMany({
        where: { organizationId, postingStatus: live, documentStatus: { notIn: ['CANCELLED', 'REJECTED'] } },
        select: {
          id: true, billNumber: true, supplierInvoiceNumber: true, billDate: true, dueDate: true, totalAmount: true, outstandingAmount: true,
          postingStatus: true, reversalJournalEntryId: true, reversedAt: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.supplierPaymentAllocation.findMany({
        where: { organizationId, postingStatus: { in: ['POSTED', 'REVERSED'] } },
        select: { supplierBillId: true, supplierPaymentId: true, allocatedAmount: true, allocationDate: true, journalEntryId: true, postingStatus: true, reversalJournalEntryId: true },
      }),
      prisma.supplierDebitNote.findMany({
        where: { organizationId, status: { in: ['POSTED', 'REVERSED'] } },
        select: { supplierBillId: true, amount: true, accountingDate: true, status: true, reversalJournalEntryId: true, reversedAt: true },
      }),
      prisma.buyerAdvanceEvidenceAllocation.findMany({
        where: { organizationId, postingStatus: { in: ['POSTED', 'REVERSED'] } },
        select: { supplierBillId: true, allocatedAmount: true, allocationDate: true, journalEntryId: true, postingStatus: true, reversalJournalEntryId: true, reversedAt: true },
      }),
      prisma.supplierPayment.findMany({
        where: { organizationId, postingStatus: { in: ['POSTED', 'REVERSED'] } },
        select: {
          id: true, totalAmount: true, unallocatedAmount: true, accountingDate: true, postingStatus: true, reversalJournalEntryId: true, reversedAt: true,
          supplier: { select: { id: true, code: true, name: true } },
        },
      }),
      prisma.supplierRefund.findMany({
        where: { organizationId, status: { in: ['POSTED', 'REVERSED'] } },
        select: { supplierPaymentId: true, amount: true, refundDate: true, status: true, reversalJournalEntryId: true, reversedAt: true },
      }),
    ]);
    const journalIds = [
      ...[...bills, ...debitNotes, ...payments, ...refunds].map((r) => r.reversalJournalEntryId),
      ...allocations.flatMap((a) => [a.journalEntryId, a.reversalJournalEntryId]),
      ...buyerCash.flatMap((a) => [a.journalEntryId, a.reversalJournalEntryId]),
    ].filter((id): id is string => Boolean(id));
    const journals = journalIds.length
      ? await prisma.journalEntry.findMany({ where: { id: { in: [...new Set(journalIds)] } }, select: { id: true, accountingDate: true } })
      : [];
    return { bills, allocations, debitNotes, buyerCash, payments, refunds, journalDates: new Map(journals.map((j) => [j.id, j.accountingDate])) };
  }

  async invoicedBetween(prisma: TenantPrisma, organizationId: string, from: Date, to: Date) {
    const r = await prisma.clientInvoice.aggregate({
      where: { organizationId, postingStatus: 'POSTED', invoiceDate: { gte: from, lte: to } },
      _sum: { totalAmount: true },
    });
    return r._sum.totalAmount;
  }

  async collectedBetween(prisma: TenantPrisma, organizationId: string, from: Date, to: Date) {
    const r = await prisma.paymentReceipt.aggregate({
      where: { organizationId, postingStatus: 'POSTED', receiptDate: { gte: from, lte: to } },
      _sum: { totalAmount: true },
    });
    return r._sum.totalAmount;
  }

  async paidBetween(prisma: TenantPrisma, organizationId: string, from: Date, to: Date) {
    const r = await prisma.supplierPayment.aggregate({
      where: { organizationId, postingStatus: 'POSTED', paymentDate: { gte: from, lte: to } },
      _sum: { totalAmount: true },
    });
    return r._sum.totalAmount;
  }
}
