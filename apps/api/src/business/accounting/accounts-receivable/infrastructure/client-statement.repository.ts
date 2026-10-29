import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = PrismaClient;

/**
 * AR-3 — the receivables documents a client statement is read from. Everything the statement
 * needs is loaded in a handful of queries; the placing and arithmetic happen in the domain.
 */
@Injectable()
export class ClientStatementRepository {
  findClient(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.client.findFirst({ where: { id: clientId, organizationId }, select: { id: true, name: true, code: true } });
  }

  /** Every invoice that ever reached the receivables book (posted, reversed, or carried in). */
  findInvoices(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, clientId, postingStatus: { in: ['POSTED', 'REVERSED', 'OPENING_BALANCE'] } },
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        dueDate: true,
        totalAmount: true,
        outstandingAmount: true,
        postingStatus: true,
        documentStatus: true,
        projectId: true,
        postedJournalEntryId: true,
        reversalJournalEntryId: true,
        reversedAt: true,
      },
    });
  }

  findCreditNotes(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.creditNote.findMany({
      where: { organizationId, invoice: { clientId }, postingStatus: { in: ['POSTED', 'REVERSED'] } },
      select: {
        id: true,
        invoiceId: true,
        creditNoteNumber: true,
        accountingDate: true,
        totalAmount: true,
        postingStatus: true,
        reversalJournalEntryId: true,
        reversedAt: true,
        invoice: { select: { invoiceNumber: true } },
      },
    });
  }

  findReceipts(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.paymentReceipt.findMany({
      where: { organizationId, clientId, postingStatus: { in: ['POSTED', 'REVERSED', 'OPENING_BALANCE'] } },
      select: {
        id: true,
        receiptNumber: true,
        reference: true,
        accountingDate: true,
        totalAmount: true,
        unallocatedAmount: true,
        postingStatus: true,
        reversalJournalEntryId: true,
        reversedAt: true,
      },
    });
  }

  /** AR-4 — posted (or posted then reversed) write-offs. */
  findWriteOffs(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.receivableWriteOff.findMany({
      where: { organizationId, clientId, status: { in: ['POSTED', 'REVERSED'] } },
      select: {
        id: true,
        invoiceId: true,
        writeOffNumber: true,
        accountingDate: true,
        amount: true,
        status: true,
        reversalJournalEntryId: true,
        reversedAt: true,
        invoice: { select: { invoiceNumber: true } },
      },
    });
  }

  /** AR-5 — posted (or posted then reversed) refunds of cash on account. */
  findRefunds(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.clientRefund.findMany({
      where: { organizationId, clientId, status: { in: ['POSTED', 'REVERSED'] } },
      select: { id: true, receiptId: true, refundNumber: true, refundDate: true, amount: true, status: true, reference: true, reversalJournalEntryId: true, reversedAt: true },
    });
  }

  /** Accounting dates of journals by id (reversals are dated by their journal). */
  async journalDates(prisma: TenantPrisma, ids: string[]): Promise<Map<string, Date>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.journalEntry.findMany({ where: { id: { in: ids } }, select: { id: true, accountingDate: true } });
    return new Map(rows.map((r) => [r.id, r.accountingDate]));
  }

  /** A receipt reversed before AR-2 stored its journal: found by the reversal's source id. */
  async receiptReversalDates(prisma: TenantPrisma, organizationId: string, receiptIds: string[]): Promise<Map<string, Date>> {
    if (receiptIds.length === 0) return new Map();
    const rows = await prisma.journalEntry.findMany({
      where: { organizationId, sourceDocumentType: 'PAYMENT_RECEIPT', sourceDocumentId: { in: receiptIds.map((id) => `reversal-${id}`) } },
      select: { sourceDocumentId: true, accountingDate: true },
    });
    return new Map(rows.map((r) => [(r.sourceDocumentId ?? '').replace(/^reversal-/, ''), r.accountingDate]));
  }

  async projectNames(prisma: TenantPrisma, organizationId: string, ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await prisma.project.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, name: true } });
    return new Map(rows.map((r) => [r.id, r.name]));
  }
}
