import type { PrismaClient } from '@prisma/client';

import { supplierBillProjectWhere } from '../../../accounting/accounts-payable/infrastructure/supplier-bill.repository.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * ADR-043 — the supplier bills "to pay" of a set of projects: POSTED, with an outstanding balance,
 * coded to one of the projects on the header or any line (`supplierBillProjectWhere`, the bills
 * list's own rule). One query behind both the portfolio's `billsToPay` and the cash-flow
 * forecast's supplier-bill outflows, so the two always agree.
 */
export function findBillsToPay(prisma: TenantPrisma, organizationId: string, projectIds: string[]) {
  if (projectIds.length === 0) return Promise.resolve([]);
  return prisma.supplierBill.findMany({
    where: {
      organizationId,
      postingStatus: 'POSTED',
      outstandingAmount: { gt: 0 },
      ...supplierBillProjectWhere({ in: projectIds }),
    },
    select: {
      id: true,
      projectId: true,
      dueDate: true,
      currencyCode: true,
      outstandingAmount: true,
      lines: { select: { projectId: true } },
    },
  });
}
