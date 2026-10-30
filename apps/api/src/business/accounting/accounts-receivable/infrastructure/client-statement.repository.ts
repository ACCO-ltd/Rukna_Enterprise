import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = PrismaClient;

/**
 * AR-3 — the receivables documents a client statement is read from. Everything the statement
 * needs is loaded in a handful of queries; the placing and arithmetic happen in the domain.
 */
@Injectable()
export class ClientStatementRepository {
  findClient(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.client.findFirst({
      where: { id: clientId, organizationId },
      select: { id: true, name: true, code: true, address: true, city: true, countryCode: true, taxNumber: true },
    });
  }

  /** ST-5 — the letterhead of a printed statement. */
  findOrganization(prisma: TenantPrisma, organizationId: string) {
    return prisma.organization.findUnique({
      where: { id: organizationId },
      select: { name: true, legalAddress: true, taxRegistrationNumber: true },
    });
  }

  /** ST-4 — the client's contracts, with their current value (base + adopted variations). */
  findContracts(prisma: TenantPrisma, organizationId: string, clientId: string) {
    return prisma.contract.findMany({
      where: { organizationId, clientId, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      select: { id: true, contractNumber: true, contractValue: true, projectId: true, status: true },
    });
  }

  /** ST-4 — live money against each invoice: receipts applied, credit notes, write-offs. */
  async settlementByInvoice(prisma: TenantPrisma, organizationId: string, invoiceIds: string[]) {
    if (invoiceIds.length === 0) return { received: new Map(), credited: new Map(), writtenOff: new Map() };
    const [received, credited, writtenOff] = await Promise.all([
      prisma.clientReceiptAllocation.groupBy({
        by: ['clientInvoiceId'],
        where: { organizationId, clientInvoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { allocatedAmount: true },
      }),
      prisma.creditNote.groupBy({
        by: ['invoiceId'],
        where: { organizationId, invoiceId: { in: invoiceIds }, postingStatus: 'POSTED' },
        _sum: { totalAmount: true },
      }),
      prisma.receivableWriteOff.groupBy({
        by: ['invoiceId'],
        where: { organizationId, invoiceId: { in: invoiceIds }, status: 'POSTED' },
        _sum: { amount: true },
      }),
    ]);
    const toMap = <T,>(rows: T[], id: (r: T) => string, amount: (r: T) => unknown) =>
      new Map(rows.map((r) => [id(r), new Decimal(String(amount(r) ?? 0))]));
    return {
      received: toMap(received, (r) => r.clientInvoiceId, (r) => r._sum.allocatedAmount),
      credited: toMap(credited, (r) => r.invoiceId, (r) => r._sum.totalAmount),
      writtenOff: toMap(writtenOff, (r) => r.invoiceId, (r) => r._sum.amount),
    };
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
        contractId: true,
        subtotal: true,
        retentionAmount: true,
        retentionReleasedAmount: true,
        sourceRetentionContractId: true,
        sourceBoqNodeId: true,
        clientReference: true,
        lines: { select: { description: true }, orderBy: { lineNo: 'asc' }, take: 1 },
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
        paymentMethod: true,
        issuer: true,
        instrumentNumber: true,
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
