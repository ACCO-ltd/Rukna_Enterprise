import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/** Step 6 — the reads behind the VAT report. */
@Injectable()
export class VatReportRepository {
  /** Accounts whose current role is output VAT. */
  async outputVatAccountIds(prisma: TenantPrisma, organizationId: string): Promise<string[]> {
    const accounts = await prisma.account.findMany({
      where: { organizationId },
      select: { id: true, versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { accountSubtype: true } } },
    });
    return accounts.filter((a) => a.versions[0]?.accountSubtype === 'VAT_OUTPUT_PAYABLE').map((a) => a.id);
  }

  /** Posted lines on those accounts dated inside the period, with their journal. */
  vatLines(prisma: TenantPrisma, organizationId: string, accountIds: string[], from: Date, to: Date) {
    return prisma.journalLine.findMany({
      where: {
        accountId: { in: accountIds },
        entry: { organizationId, status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { gte: from, lte: to } },
      },
      select: {
        debitAmount: true,
        creditAmount: true,
        entry: {
          select: {
            id: true, journalNumber: true, accountingDate: true, sourceDocumentType: true, sourceDocumentId: true,
            reversalOfJournalEntryId: true,
            // A reversal names its document by the journal it reverses (its own source id is not the document's).
            reversalOf: { select: { sourceDocumentType: true, sourceDocumentId: true } },
          },
        },
      },
      orderBy: [{ entry: { accountingDate: 'asc' } }, { entry: { journalNumber: 'asc' } }],
    });
  }

  /** The credit balance of the accounts up to and including `to`. */
  async balanceTo(prisma: TenantPrisma, organizationId: string, accountIds: string[], to: Date) {
    const sum = await prisma.journalLine.aggregate({
      where: { accountId: { in: accountIds }, entry: { organizationId, status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { lte: to } } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return { debit: sum._sum.debitAmount, credit: sum._sum.creditAmount };
  }

  invoices(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    return prisma.clientInvoice.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, invoiceNumber: true, subtotal: true, taxRate: true, client: { select: { name: true } } },
    });
  }

  creditNotes(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    return prisma.creditNote.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, creditNoteNumber: true, netAmount: true, invoice: { select: { taxRate: true, client: { select: { name: true } } } } },
    });
  }

  /** Supplier bills whose posting (or its reversal) is dated inside the period. */
  billPostings(prisma: TenantPrisma, organizationId: string, from: Date, to: Date) {
    return prisma.journalEntry.findMany({
      where: { organizationId, sourceDocumentType: 'SUPPLIER_BILL', status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { gte: from, lte: to } },
      select: { sourceDocumentId: true, reversalOfJournalEntryId: true, reversalOf: { select: { sourceDocumentId: true } } },
    });
  }

  bills(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    return prisma.supplierBill.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true, subtotal: true, vatAmount: true } });
  }
}
