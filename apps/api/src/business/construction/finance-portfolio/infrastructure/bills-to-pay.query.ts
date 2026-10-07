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
  return findOpenPostedBills(prisma, organizationId, projectIds);
}

/**
 * The same "to pay" rule, also organisation-wide: `projectIds === null` drops the project filter
 * (bills coded to no project included). Behind the Dashboard's payables figures, so they agree
 * with the portfolio's bills to pay for the same projects.
 */
export function findOpenPostedBills(prisma: TenantPrisma, organizationId: string, projectIds: string[] | null) {
  if (projectIds !== null && projectIds.length === 0) return Promise.resolve([]);
  return prisma.supplierBill.findMany({
    where: {
      organizationId,
      postingStatus: 'POSTED',
      outstandingAmount: { gt: 0 },
      ...(projectIds !== null ? supplierBillProjectWhere({ in: projectIds }) : {}),
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
