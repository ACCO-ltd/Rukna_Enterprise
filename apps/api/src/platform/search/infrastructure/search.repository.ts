import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

const LIMIT = 5;
const contains = (q: string) => ({ contains: q, mode: 'insensitive' as const });

/**
 * Read-only lookups for the ⌘K record search (Step 2f). One small query per record type, each
 * bounded and org-scoped; the service decides which ones a caller may run. Reads tables owned by
 * other modules through Prisma only — it imports none of their services.
 */
@Injectable()
export class SearchRepository {
  invoices(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.clientInvoice.findMany({
      where: {
        organizationId,
        OR: [{ invoiceNumber: contains(q) }, { client: { name: contains(q) } }],
      },
      orderBy: { invoiceDate: 'desc' },
      take: LIMIT,
      select: {
        id: true,
        invoiceNumber: true,
        invoiceDate: true,
        totalAmount: true,
        outstandingAmount: true,
        currencyCode: true,
        documentStatus: true,
        postingStatus: true,
        clientId: true,
        client: { select: { name: true } },
      },
    });
  }

  bills(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.supplierBill.findMany({
      where: {
        organizationId,
        OR: [{ billNumber: contains(q) }, { supplierInvoiceNumber: contains(q) }, { supplier: { name: contains(q) } }],
      },
      orderBy: { billDate: 'desc' },
      take: LIMIT,
      select: {
        id: true,
        billNumber: true,
        supplierInvoiceNumber: true,
        totalAmount: true,
        currencyCode: true,
        documentStatus: true,
        postingStatus: true,
        supplier: { select: { name: true } },
      },
    });
  }

  payments(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.supplierPayment.findMany({
      where: { organizationId, OR: [{ paymentNumber: contains(q) }, { supplier: { name: contains(q) } }] },
      orderBy: { paymentDate: 'desc' },
      take: LIMIT,
      select: {
        id: true,
        paymentNumber: true,
        paymentDate: true,
        totalAmount: true,
        currencyCode: true,
        postingStatus: true,
        supplier: { select: { name: true } },
      },
    });
  }

  receipts(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.paymentReceipt.findMany({
      where: {
        organizationId,
        OR: [{ receiptNumber: contains(q) }, { reference: contains(q) }, { client: { name: contains(q) } }],
      },
      orderBy: { receiptDate: 'desc' },
      take: LIMIT,
      select: {
        id: true,
        receiptNumber: true,
        reference: true,
        receiptDate: true,
        totalAmount: true,
        currencyCode: true,
        postingStatus: true,
        clientId: true,
        client: { select: { name: true } },
      },
    });
  }

  journals(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.journalEntry.findMany({
      where: {
        organizationId,
        sourceDocumentType: 'MANUAL_JOURNAL',
        replacedByJournalEntryId: null,
        OR: [{ journalNumber: contains(q) }, { description: contains(q) }],
      },
      orderBy: { accountingDate: 'desc' },
      take: LIMIT,
      select: { id: true, journalNumber: true, description: true, accountingDate: true, status: true },
    });
  }

  /** `projectIds` undefined = every project (a membership-bypass role). */
  projects(prisma: TenantPrisma, organizationId: string, q: string, projectIds: string[] | undefined) {
    return prisma.project.findMany({
      where: {
        organizationId,
        ...(projectIds ? { id: { in: projectIds } } : {}),
        OR: [{ code: contains(q) }, { name: contains(q) }],
      },
      orderBy: { name: 'asc' },
      take: LIMIT,
      select: { id: true, code: true, name: true, status: true, clientId: true },
    });
  }

  clients(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.client.findMany({
      where: { organizationId, OR: [{ code: contains(q) }, { name: contains(q) }] },
      orderBy: { name: 'asc' },
      take: LIMIT,
      select: { id: true, code: true, name: true, status: true },
    });
  }

  suppliers(prisma: TenantPrisma, organizationId: string, q: string) {
    return prisma.supplier.findMany({
      where: { organizationId, OR: [{ code: contains(q) }, { name: contains(q) }] },
      orderBy: { name: 'asc' },
      take: LIMIT,
      select: { id: true, code: true, name: true, status: true },
    });
  }
}
