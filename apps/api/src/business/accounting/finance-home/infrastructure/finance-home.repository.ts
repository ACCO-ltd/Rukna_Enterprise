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
