import type { PrismaClient } from '@prisma/client';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * R-2 — issued invoices with a balance that belong to no project (hand-typed sales, equipment
 * hire). The company-wide cash-flow forecast counts them; a project's forecast never does.
 */
export function findUnprojectedOpenInvoices(prisma: TenantPrisma, organizationId: string) {
  return prisma.clientInvoice.findMany({
    where: {
      organizationId,
      projectId: null,
      postingStatus: 'POSTED',
      documentStatus: { not: 'CANCELLED' },
      outstandingAmount: { gt: 0 },
    },
    select: { id: true, dueDate: true, invoiceDate: true, currencyCode: true, outstandingAmount: true },
  });
}
