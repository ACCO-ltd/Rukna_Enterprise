import { Injectable } from '@nestjs/common';
import type { PrismaClient, Prisma } from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

@Injectable()
export class ProgressRepository {
  createDpr(prisma: TenantPrisma, data: Prisma.DailyProgressReportUncheckedCreateInput) {
    return prisma.dailyProgressReport.create({ data });
  }

  findDpr(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.dailyProgressReport.findFirst({
      where: { id, organizationId },
      include: {
        measurements: {
          include: { boqNode: { select: { code: true, description: true, quantity: true } } },
        },
        attachments: {
          include: { platformFile: { select: { originalName: true, mimeType: true, status: true } } },
        },
      },
    });
  }

  findDprsByProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.dailyProgressReport.findMany({
      where: { organizationId, projectId },
      orderBy: { reportDate: 'desc' },
    });
  }

  updateDprStatus(
    prisma: TenantPrisma,
    id: string,
    data: Prisma.DailyProgressReportUncheckedUpdateInput,
  ) {
    return prisma.dailyProgressReport.update({ where: { id }, data });
  }

  addMeasurement(prisma: TenantPrisma, data: Prisma.ProgressMeasurementUncheckedCreateInput) {
    return prisma.progressMeasurement.create({ data });
  }

  createAttachment(prisma: TenantPrisma, data: Prisma.DprAttachmentUncheckedCreateInput) {
    return prisma.dprAttachment.create({ data });
  }

  /** The BOQ leaf must belong to this project's BOQ. Returns the measurable quantity + leaf flag. */
  findBoqNodeForProject(prisma: TenantPrisma, projectId: string, boqNodeId: string) {
    return prisma.boqNode.findFirst({
      where: { id: boqNodeId, version: { boq: { projectId } } },
      select: { id: true, quantity: true, isLeaf: true },
    });
  }

  /** Σ of verified (APPROVED-DPR) measured quantity for a BOQ node, optionally excluding one DPR. */
  sumVerifiedForNode(
    prisma: TenantPrisma,
    organizationId: string,
    boqNodeId: string,
    excludeDprId?: string,
  ) {
    return prisma.progressMeasurement.aggregate({
      _sum: { quantity: true },
      where: {
        organizationId,
        boqNodeId,
        dpr: { status: 'APPROVED' },
        ...(excludeDprId ? { dprId: { not: excludeDprId } } : {}),
      },
    });
  }

  approvedMeasurementsForProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.progressMeasurement.findMany({
      where: { organizationId, dpr: { projectId, status: 'APPROVED' } },
      include: { boqNode: { select: { id: true, code: true, description: true, quantity: true } } },
    });
  }

  findFileStatus(prisma: TenantPrisma, organizationId: string, fileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, status: true },
    });
  }

  // ─── Work packages (ADR-021 roll-up) ────────────────────────────────────────────

  createWorkPackage(prisma: TenantPrisma, data: Prisma.WorkPackageUncheckedCreateInput) {
    return prisma.workPackage.create({ data });
  }

  findWorkPackageById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.workPackage.findFirst({
      where: { id, organizationId },
      select: { id: true, projectId: true },
    });
  }

  findWorkPackages(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.workPackage.findMany({
      where: { organizationId, projectId },
      orderBy: { code: 'asc' },
      include: { boqLinks: { select: { boqNodeId: true } } },
    });
  }

  /** The work package a leaf is already allocated to, or null. A leaf allocates to at most one. */
  findLeafAllocation(prisma: TenantPrisma, boqNodeId: string) {
    return prisma.workPackageBoqNode.findUnique({
      where: { boqNodeId },
      select: { workPackageId: true },
    });
  }

  allocateBoqNode(prisma: TenantPrisma, workPackageId: string, boqNodeId: string) {
    return prisma.workPackageBoqNode.create({ data: { workPackageId, boqNodeId } });
  }

  // ── ADR-021 CONST-PROG-011: planned-progress target curve ────────────────────
  findTargets(prisma: TenantPrisma, projectId: string) {
    return prisma.progressTarget.findMany({ where: { projectId }, orderBy: { targetDate: 'asc' } });
  }

  deleteTargetsForProject(prisma: TenantPrisma, projectId: string) {
    return prisma.progressTarget.deleteMany({ where: { projectId } });
  }

  createTargets(prisma: TenantPrisma, rows: Prisma.ProgressTargetUncheckedCreateInput[]) {
    return prisma.progressTarget.createMany({ data: rows });
  }

  // ── Round-2 Progress-over-time (BE-1): immutable progress snapshots ───────────
  createSnapshot(prisma: TenantPrisma, data: Prisma.ProgressSnapshotUncheckedCreateInput) {
    return prisma.progressSnapshot.create({ data });
  }

  /** The one snapshot for a project at a period-end date, or null (drives the unique-per-period check). */
  findSnapshotForPeriod(prisma: TenantPrisma, projectId: string, periodEndDate: Date) {
    return prisma.progressSnapshot.findUnique({
      where: { projectId_periodEndDate: { projectId, periodEndDate } },
      select: { id: true },
    });
  }

  /** A project's snapshot series, oldest first (the actual line + period-comparison source). */
  findSnapshotsForProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.progressSnapshot.findMany({
      where: { organizationId, projectId },
      orderBy: { periodEndDate: 'asc' },
    });
  }

  /** The project's baseline dates (Option-C provisional planned curve). Org-scoped for tenancy. */
  findProjectDates(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: { startDate: true, expectedEndDate: true },
    });
  }

  // ── ADR-021 CONST-PROG-005: programme activities (time layer under a work package) ──
  createActivity(prisma: TenantPrisma, data: Prisma.ProgrammeActivityUncheckedCreateInput) {
    return prisma.programmeActivity.create({ data });
  }

  findActivitiesForWorkPackage(prisma: TenantPrisma, workPackageId: string) {
    return prisma.programmeActivity.findMany({
      where: { workPackageId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  findActivitiesForProject(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.programmeActivity.findMany({
      where: { organizationId, workPackage: { projectId } },
      orderBy: [{ workPackageId: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  findActivityById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.programmeActivity.findFirst({
      where: { id, organizationId },
      include: { workPackage: { select: { projectId: true } } },
    });
  }

  updateActivity(prisma: TenantPrisma, id: string, data: Prisma.ProgrammeActivityUncheckedUpdateInput) {
    return prisma.programmeActivity.update({ where: { id }, data });
  }

  deleteActivity(prisma: TenantPrisma, id: string) {
    return prisma.programmeActivity.delete({ where: { id } });
  }
}
