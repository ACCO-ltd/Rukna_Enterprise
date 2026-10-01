import type { PrismaClient } from '@prisma/client';

/**
 * ADR-041 — what the migration gives every existing organisation: a 5% sales tax code made the
 * default. A test organisation created after the migration has none, so a spec that raises client
 * invoices seeds it (and removes it before deleting the organisation — invoices reference it).
 */
export async function seedDefaultSalesTax(prisma: PrismaClient, organizationId: string, ratePercent = 5) {
  const code = await prisma.taxCode.create({
    data: {
      organizationId,
      code: 'VAT5_OUT',
      name: `Sales tax ${ratePercent}%`,
      rate: ratePercent,
      taxType: 'VAT',
      direction: 'OUTPUT',
      recoveryMethod: 'FULLY_RECOVERABLE',
      effectiveFrom: new Date('2000-01-01T00:00:00.000Z'),
      createdBy: 'test',
    },
  });
  await prisma.taxPolicy.upsert({
    where: { organizationId },
    create: { organizationId, defaultOutputTaxCodeId: code.id, updatedBy: 'test' },
    update: { defaultOutputTaxCodeId: code.id, updatedBy: 'test' },
  });
  return code;
}

/** Remove the tax policy and codes; call after the organisation's invoices are deleted. */
export async function cleanupSalesTax(prisma: PrismaClient, organizationId: string) {
  await prisma.taxPolicy.deleteMany({ where: { organizationId } });
  await prisma.taxCode.deleteMany({ where: { organizationId } });
}
