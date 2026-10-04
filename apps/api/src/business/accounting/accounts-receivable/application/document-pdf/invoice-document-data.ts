import type { PrismaClient } from '@prisma/client';

import type { InvoiceLineSource } from './invoice-view-model.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Read-side facts the invoice PDF prints that are not in the invoice's frozen snapshot: the project
 * it bills, and what it was raised from (stage of the payment schedule, variation, IPC, separate
 * charge). Read once, when the document is first generated — after that the stored PDF is
 * immutable, so a later change to the project or schedule never reaches it.
 */

export async function loadInvoiceProject(
  prisma: TenantPrisma,
  organizationId: string,
  projectId: string | null,
): Promise<{ code: string; name: string; location: string | null } | null> {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({
    where: { id: projectId, organizationId },
    select: { code: true, name: true, location: true, district: { select: { name: true } } },
  });
  if (!project) return null;
  const location = project.location?.trim() || null;
  const district = project.district?.name?.trim() || null;
  // "Hodan District, Mogadishu": the free-text location, prefixed by the district when it is not
  // already part of it.
  const parts = [
    district && !(location ?? '').toLowerCase().includes(district.toLowerCase()) ? district : null,
    location,
  ].filter((part): part is string => part !== null);
  return { code: project.code, name: project.name, location: parts.length > 0 ? parts.join(', ') : null };
}

export async function loadInvoiceLineSource(
  prisma: TenantPrisma,
  invoice: {
    id: string;
    organizationId: string;
    contractId: string | null;
    sourceInstallmentId: string | null;
    subtotal: { toString(): string };
    currencyCode: string;
  },
  description: string,
): Promise<InvoiceLineSource> {
  const [contract, installment, variations] = await Promise.all([
    invoice.contractId
      ? prisma.contract.findFirst({
          where: { id: invoice.contractId, organizationId: invoice.organizationId },
          select: { contractNumber: true },
        })
      : null,
    invoice.sourceInstallmentId
      ? prisma.contractPaymentInstallment.findUnique({
          where: { id: invoice.sourceInstallmentId },
          select: {
            id: true,
            name: true,
            percentage: true,
            contract: {
              select: {
                contractValue: true,
                baseContractValue: true,
                paymentInstallments: { select: { id: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
              },
            },
          },
        })
      : null,
    prisma.variationBillingAllocation.findMany({
      where: { clientInvoiceId: invoice.id, organizationId: invoice.organizationId },
      orderBy: { createdAt: 'asc' },
      select: {
        amount: true,
        treatment: true,
        variation: { select: { reference: true, title: true, clientApprovedAt: true } },
      },
    }),
  ]);

  return {
    description,
    subtotal: invoice.subtotal.toString(),
    currencyCode: invoice.currencyCode,
    contractNumber: contract?.contractNumber ?? null,
    installment: installment
      ? {
          name: installment.name,
          position: installment.contract.paymentInstallments.findIndex((i) => i.id === installment.id) + 1,
          count: installment.contract.paymentInstallments.length,
          percentage: installment.percentage.toString(),
          scheduleBase: (installment.contract.baseContractValue ?? installment.contract.contractValue).toString(),
        }
      : null,
    variations: variations.map((v) => ({
      reference: v.variation.reference,
      title: v.variation.title,
      clientApproved: v.variation.clientApprovedAt !== null,
      treatment: v.treatment,
      amount: v.amount.toString(),
    })),
  };
}
