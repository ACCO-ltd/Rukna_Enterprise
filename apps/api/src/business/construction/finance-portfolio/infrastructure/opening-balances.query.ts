import type { PrismaClient } from '@prisma/client';

import { supplierBillProjectWhere } from '../../../accounting/accounts-payable/infrastructure/supplier-bill.repository.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Which opening-balance documents a cash-flow forecast covers (ADR-043 Phase 4):
 * - one project → only documents coded to it (`projectId`);
 * - company-wide for a caller who sees every project (`accessible` undefined) → all of them,
 *   including the usual case of no project at all (QuickBooks imports carry none);
 * - company-wide for a caller limited to their projects → only documents coded to those.
 */
export type OpeningBalanceScope =
  | { kind: 'PROJECT'; projectId: string }
  | { kind: 'ALL' }
  | { kind: 'PROJECTS'; projectIds: string[] };

/**
 * OPENING_BALANCE client invoices (imported at go-live) with an outstanding balance — the same
 * outstanding definition (`outstandingAmount`) as posted invoices. The POSTED-only helpers behind
 * the portfolio are deliberately untouched; the forecast shows these as their own line.
 */
export function findOpeningReceivables(prisma: TenantPrisma, organizationId: string, scope: OpeningBalanceScope) {
  if (scope.kind === 'PROJECTS' && scope.projectIds.length === 0) return Promise.resolve([]);
  return prisma.clientInvoice.findMany({
    where: {
      organizationId,
      postingStatus: 'OPENING_BALANCE',
      outstandingAmount: { gt: 0 },
      ...(scope.kind === 'PROJECT' ? { projectId: scope.projectId } : {}),
      ...(scope.kind === 'PROJECTS' ? { projectId: { in: scope.projectIds } } : {}),
    },
    select: { id: true, dueDate: true, currencyCode: true, outstandingAmount: true },
  });
}

/** OPENING_BALANCE supplier bills with an outstanding balance; project match = header or any line. */
export function findOpeningPayables(prisma: TenantPrisma, organizationId: string, scope: OpeningBalanceScope) {
  if (scope.kind === 'PROJECTS' && scope.projectIds.length === 0) return Promise.resolve([]);
  return prisma.supplierBill.findMany({
    where: {
      organizationId,
      postingStatus: 'OPENING_BALANCE',
      outstandingAmount: { gt: 0 },
      ...(scope.kind === 'PROJECT' ? supplierBillProjectWhere(scope.projectId) : {}),
      ...(scope.kind === 'PROJECTS' ? supplierBillProjectWhere({ in: scope.projectIds }) : {}),
    },
    select: { id: true, dueDate: true, currencyCode: true, outstandingAmount: true },
  });
}
