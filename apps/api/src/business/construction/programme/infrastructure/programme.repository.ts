import { Injectable } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProgrammeRepository {
  createMilestone(prisma: TenantPrisma, data: Prisma.ProgrammeMilestoneUncheckedCreateInput) {
    return prisma.programmeMilestone.create({ data });
  }

  /**
   * The milestone read model for a project — or for one milestone of it when `milestoneId` is given
   * (the PUT work-packages response re-reads through the same shape, so both stay identical).
   */
  findMilestones(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    milestoneId?: string,
  ) {
    return prisma.programmeMilestone.findMany({
      where: { organizationId, projectId, ...(milestoneId ? { id: milestoneId } : {}) },
      orderBy: [{ sortOrder: 'asc' }, { baselineDate: 'asc' }],
      include: {
        // Master Schedule P2 — the payment installments this milestone RELEASES, one query. Only the
        // read-side fields the release projection needs: identity, percentage/trigger, the parent
        // contract's value + currency (to derive the amount), and whether an invoice was generated.
        installments: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            name: true,
            percentage: true,
            triggerType: true,
            contract: { select: { contractValue: true, currency: true } },
            clientInvoice: { select: { id: true } },
          },
        },
        // ADR-021 amendment (2026-09-28) — the packages that make up this stage, with the leaf ids
        // their verified % is derived from.
        workPackageLinks: {
          orderBy: { workPackage: { code: 'asc' } },
          select: {
            workPackage: {
              select: {
                id: true,
                code: true,
                name: true,
                scheduleOnly: true,
                boqLinks: { select: { boqNodeId: true } },
              },
            },
          },
        },
      },
    });
  }

  findMilestoneById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.programmeMilestone.findFirst({ where: { id, organizationId } });
  }

  verifyMilestone(prisma: TenantPrisma, id: string, actualDate: Date, verifiedBy: string) {
    return prisma.programmeMilestone.update({
      where: { id },
      data: { status: 'VERIFIED', actualDate, verifiedBy, verifiedAt: new Date() },
    });
  }

  // ── ADR-021 amendment (2026-09-28): milestone ↔ work package link ─────────────────────

  /** The named work packages that exist on this project (tenant-scoped), for link validation. */
  findWorkPackagesForProject(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    workPackageIds: string[],
  ) {
    return prisma.workPackage.findMany({
      where: { organizationId, projectId, id: { in: workPackageIds } },
      select: { id: true, code: true, scheduleOnly: true },
    });
  }

  /** Replace a milestone's linked set. Call inside a transaction so the swap is all-or-nothing. */
  async replaceMilestoneWorkPackages(
    prisma: TenantPrisma,
    milestoneId: string,
    workPackageIds: string[],
    createdBy: string,
  ): Promise<void> {
    await prisma.programmeMilestoneWorkPackage.deleteMany({ where: { milestoneId } });
    if (workPackageIds.length === 0) return;
    await prisma.programmeMilestoneWorkPackage.createMany({
      data: workPackageIds.map((workPackageId) => ({ milestoneId, workPackageId, createdBy })),
    });
  }

  /**
   * The raw material for a work package's verified % — the same inputs the progress roll-up reads:
   * each leaf's measurable quantity, value and role, and the Σ quantity verified on it by APPROVED
   * reports. Scoped to the project's BOQ (leaves) and the organization (measurements).
   */
  async findLeafProgressInputs(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    boqNodeIds: string[],
  ) {
    if (boqNodeIds.length === 0) return { leaves: [], verified: [] };
    const [leaves, verified] = await Promise.all([
      prisma.boqNode.findMany({
        where: { id: { in: boqNodeIds }, version: { boq: { projectId } } },
        select: { id: true, quantity: true, totalAmount: true, nodeRole: true },
      }),
      prisma.progressMeasurement.groupBy({
        by: ['boqNodeId'],
        where: {
          organizationId,
          boqNodeId: { in: boqNodeIds },
          dpr: { projectId, status: 'APPROVED' },
        },
        _sum: { quantity: true },
      }),
    ]);
    return { leaves, verified };
  }
}
