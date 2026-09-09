import { Injectable } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Master Schedule P3 (ADR-029) — persistence for the frozen, versioned programme baseline.
 *
 * Prisma lives only here (Clean Architecture): the service owns the invariants and reads/writes
 * through these methods. Every method is tenant-scoped by `organizationId` the way the rest of the
 * progress infrastructure is; the `tx`-taking writers exist so approve/re-baseline run inside one
 * transaction alongside the audit-outbox record.
 */
@Injectable()
export class ProgrammeBaselineRepository {
  /** The current governing baseline (APPROVED) for a project, with its frozen curve, or null. */
  findApproved(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.programmeBaseline.findFirst({
      where: { organizationId, projectId, status: 'APPROVED' },
      include: { points: { orderBy: { targetDate: 'asc' } } },
    });
  }

  /** The highest version number a project has ever had (null when none), to number the next. */
  async findLatestVersion(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<number | null> {
    const last = await prisma.programmeBaseline.findFirst({
      where: { organizationId, projectId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return last?.version ?? null;
  }

  /** A baseline by id (with its curve), tenant-scoped — the read after a write returns this shape. */
  findById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.programmeBaseline.findFirst({
      where: { id, organizationId },
      include: { points: { orderBy: { targetDate: 'asc' } } },
    });
  }

  /** A Variation resolved to its owning project (via its contract), for the re-baseline provenance check. */
  findVariationOrderProject(prisma: TenantPrisma, organizationId: string, variationOrderId: string) {
    return prisma.variationOrder.findFirst({
      where: { id: variationOrderId, organizationId },
      select: { id: true, contract: { select: { projectId: true } } },
    });
  }

  /** Supersede every currently-APPROVED baseline for a project (0 or 1 in practice). */
  supersedeApproved(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.programmeBaseline.updateMany({
      where: { organizationId, projectId, status: 'APPROVED' },
      data: { status: 'SUPERSEDED' },
    });
  }

  /**
   * Freeze a new APPROVED baseline version with its snapshotted curve in one create. Points are
   * created nested so the version and its frozen curve commit atomically.
   */
  createApproved(
    prisma: TenantPrisma,
    data: {
      organizationId: string;
      projectId: string;
      version: number;
      approvedBy: string;
      approvedAt: Date;
      variationOrderId: string | null;
      note: string | null;
      points: { targetDate: Date; cumulativePercent: Prisma.Decimal }[];
    },
  ) {
    return prisma.programmeBaseline.create({
      data: {
        organizationId: data.organizationId,
        projectId: data.projectId,
        version: data.version,
        status: 'APPROVED',
        approvedBy: data.approvedBy,
        approvedAt: data.approvedAt,
        variationOrderId: data.variationOrderId,
        note: data.note,
        points: {
          create: data.points.map((p) => ({
            targetDate: p.targetDate,
            cumulativePercent: p.cumulativePercent,
          })),
        },
      },
      select: { id: true },
    });
  }

  /** The live planned-target curve — the raw material a baseline snapshots at approval. */
  findTargets(prisma: TenantPrisma, projectId: string) {
    return prisma.progressTarget.findMany({ where: { projectId }, orderBy: { targetDate: 'asc' } });
  }
}
