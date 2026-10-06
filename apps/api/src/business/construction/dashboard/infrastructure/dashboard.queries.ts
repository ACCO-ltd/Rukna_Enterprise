import type { PrismaClient } from '@prisma/client';

import { supplierBillProjectWhere } from '../../../accounting/accounts-payable/infrastructure/supplier-bill.repository.js';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * The Dashboard's own reads (`GET /dashboard`) — only what no existing repository already answers.
 * Every figure that a per-module screen owns is read through that module's repository instead
 * (portfolio rows, receivables, bills to pay, readiness, progress, milestones, activity). Each
 * function here is one query, scoped to the organisation and — where `projectIds` is given — to
 * the caller's projects (`null` = the caller sees every project).
 */

/** Project counts by status across the whole organisation — the stage is decided on the company. */
export async function countOrgProjectsByStatus(prisma: TenantPrisma, organizationId: string) {
  const rows = await prisma.project.groupBy({
    by: ['status'],
    where: { organizationId },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((r) => [r.status as string, r._count._all])) as Record<
    string,
    number
  >;
}

/** The caller's projects with what the dashboard lists about them. */
export function findDashboardProjects(
  prisma: TenantPrisma,
  organizationId: string,
  projectIds: string[] | null,
) {
  return prisma.project.findMany({
    where: { organizationId, ...(projectIds !== null ? { id: { in: projectIds } } : {}) },
    select: {
      id: true,
      code: true,
      name: true,
      status: true,
      commercialModel: true,
      currency: true,
      contractValue: true,
      clientName: true,
      updatedAt: true,
      client: { select: { name: true } },
    },
    orderBy: { code: 'asc' },
  });
}

/** SUBMITTED material requests someone else raised, on the caller's projects (or all). */
export function findMaterialRequestsAwaitingApproval(
  prisma: TenantPrisma,
  organizationId: string,
  callerUserId: string,
  projectIds: string[] | null,
) {
  return prisma.materialRequest.findMany({
    where: {
      organizationId,
      status: 'SUBMITTED',
      requestedBy: { not: callerUserId },
      // A member-scoped approver sees only their projects' requests; organisation-level requests
      // (no project) are left to the approvers who see every project.
      ...(projectIds !== null ? { projectId: { in: projectIds } } : {}),
    },
    select: {
      id: true,
      mrNumber: true,
      title: true,
      projectId: true,
      requiredByDate: true,
      currencyCode: true,
    },
    orderBy: [{ requiredByDate: { sort: 'asc', nulls: 'last' } }, { mrNumber: 'asc' }],
    take: 50,
  });
}

/** Live, unposted supplier bills whose PO match raised an exception. */
export function findBillMatchExceptions(
  prisma: TenantPrisma,
  organizationId: string,
  projectIds: string[] | null,
) {
  if (projectIds !== null && projectIds.length === 0) return Promise.resolve([]);
  return prisma.supplierBill.findMany({
    where: {
      organizationId,
      matchStatus: 'EXCEPTION',
      postingStatus: 'NOT_POSTED',
      documentStatus: { notIn: ['REJECTED', 'CANCELLED'] },
      ...(projectIds !== null ? supplierBillProjectWhere({ in: projectIds }) : {}),
    },
    select: {
      id: true,
      billNumber: true,
      currencyCode: true,
      totalAmount: true,
      updatedAt: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
    take: 50,
  });
}

/**
 * SUBMITTED supplier bills the caller did not enter. A bill records who entered it (`createdBy`)
 * but not who pressed Submit, and the clerk who enters a bill is the one who submits it — the same
 * person the reject rule (`SupplierBillService.reject`) keeps away from deciding on it. The last
 * update of a SUBMITTED bill is its submission (a submitted bill cannot be edited; auto-match runs
 * in the same request), so `updatedAt` stands for "submitted at".
 */
export function findBillsAwaitingApproval(
  prisma: TenantPrisma,
  organizationId: string,
  callerUserId: string,
  projectIds: string[] | null,
) {
  if (projectIds !== null && projectIds.length === 0) return Promise.resolve([]);
  return prisma.supplierBill.findMany({
    where: {
      organizationId,
      documentStatus: 'SUBMITTED',
      createdBy: { not: callerUserId },
      ...(projectIds !== null ? supplierBillProjectWhere({ in: projectIds }) : {}),
    },
    select: {
      id: true,
      billNumber: true,
      currencyCode: true,
      totalAmount: true,
      updatedAt: true,
      supplier: { select: { name: true } },
    },
    orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
  });
}

/** SUBMITTED daily reports per project — count and oldest report date — in one grouped query. */
export async function findReportsAwaitingReview(
  prisma: TenantPrisma,
  organizationId: string,
  projectIds: string[],
) {
  if (projectIds.length === 0) return [];
  const rows = await prisma.dailyProgressReport.groupBy({
    by: ['projectId'],
    where: { organizationId, status: 'SUBMITTED', projectId: { in: projectIds } },
    _count: { _all: true },
    _min: { reportDate: true },
  });
  return rows.map((r) => ({
    projectId: r.projectId,
    count: r._count._all,
    oldestReportDate: r._min.reportDate,
  }));
}

/** The organisation's name. */
export async function findOrganizationName(
  prisma: TenantPrisma,
  organizationId: string,
): Promise<string> {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { name: true },
  });
  return org?.name ?? '';
}

/** The facts behind the new-company checklist (stage NEW), counted together. */
export async function findSetupFacts(prisma: TenantPrisma, organizationId: string) {
  const [clientCount, projectCount, supplierCount, materialCount, activeUserCount] =
    await Promise.all([
      prisma.client.count({ where: { organizationId } }),
      prisma.project.count({ where: { organizationId, status: { not: 'CANCELLED' } } }),
      prisma.supplier.count({ where: { organizationId } }),
      prisma.material.count({ where: { organizationId } }),
      prisma.organizationMembership.count({
        where: { organizationId, status: 'ACTIVE', removedAt: null, user: { status: 'ACTIVE' } },
      }),
    ]);
  return { clientCount, projectCount, supplierCount, materialCount, activeUserCount };
}
