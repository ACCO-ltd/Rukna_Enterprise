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

  /**
   * Batch-resolve users by id, tenant-scoped. Read-side only: the DPR's preparedBy/submittedBy/
   * approvedBy are plain string columns (not Prisma relations), so the service resolves the id→name
   * map from these rows. Empty input short-circuits to avoid a needless query.
   */
  findUserNamesByIds(
    prisma: TenantPrisma,
    organizationId: string,
    ids: string[],
  ): Promise<{ id: string; firstName: string; lastName: string }[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.user.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, firstName: true, lastName: true },
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

  /** The files behind a report's evidence — read when approval freezes them. */
  async findAttachmentFileIds(prisma: TenantPrisma, dprId: string): Promise<string[]> {
    const rows = await prisma.dprAttachment.findMany({
      where: { dprId },
      select: { platformFileId: true },
    });
    return rows.map((row) => row.platformFileId);
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

  /**
   * Master Schedule P1-b (ADR-029): the APPROVED-DPR report dates on which a set of BOQ leaves were
   * measured — the raw material for a work package's DERIVED actualStart/actualFinish. One batched
   * query for every leaf across all packages (not N-per-WP): the service folds the rows into per-node
   * min/max and then per-WP boundaries.
   *
   * `reportDate` is a `@db.Date` on the report, not the measurement, so it travels via the `dpr`
   * relation. A single distinct (node, date) pair is enough — the earliest is the start, the latest
   * the (candidate) finish — so several measurements on the same day collapse to one row.
   */
  async approvedReportDatesForLeaves(
    prisma: TenantPrisma,
    organizationId: string,
    boqNodeIds: string[],
  ): Promise<{ boqNodeId: string; reportDate: Date }[]> {
    if (boqNodeIds.length === 0) return [];
    const rows = await prisma.progressMeasurement.findMany({
      where: {
        organizationId,
        boqNodeId: { in: boqNodeIds },
        dpr: { status: 'APPROVED' },
      },
      select: { boqNodeId: true, dpr: { select: { reportDate: true } } },
      distinct: ['boqNodeId', 'dprId'],
    });
    return rows.map((r) => ({ boqNodeId: r.boqNodeId, reportDate: r.dpr.reportDate }));
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

  /**
   * How many work packages a project already has — the zero-guard for applying a schedule template
   * (P1-d): the template seeds a fresh project's phases, and refuses (409) rather than silently
   * duplicate onto a project that already has any. A count, not a fetch: the guard only needs "any?".
   */
  countWorkPackages(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.workPackage.count({ where: { organizationId, projectId } });
  }

  findWorkPackageById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.workPackage.findFirst({
      where: { id, organizationId },
      select: { id: true, projectId: true },
    });
  }

  /**
   * A work package with its BOQ-link count, for the update path: the schedule-only guard
   * (a non-measurable phase must own no BOQ scope, master-schedule §8.5) needs to know whether the
   * package has any allocations before it is flagged schedule-only.
   */
  findWorkPackageForUpdate(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.workPackage.findFirst({
      where: { id, organizationId },
      select: { id: true, projectId: true, _count: { select: { boqLinks: true } } },
    });
  }

  updateWorkPackage(prisma: TenantPrisma, id: string, data: Prisma.WorkPackageUncheckedUpdateInput) {
    return prisma.workPackage.update({ where: { id }, data });
  }

  findWorkPackages(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.workPackage.findMany({
      where: { organizationId, projectId },
      orderBy: { code: 'asc' },
      // The schedule window (P1-a) travels with the roll-up so the master-schedule read model has the
      // planned dates alongside the derived %. boqLinks stays included for the value-weighted roll-up.
      include: { boqLinks: { select: { boqNodeId: true } } },
    });
  }

  /**
   * The contract value of each allocated leaf, so the roll-up can weight a package's items by
   * what they are worth rather than counting them equally. `totalAmount` is the server-computed
   * line value, so the weighting always agrees with the BOQ's own arithmetic.
   *
   * Scoped through the BOQ rather than by `organizationId`, the way every other node read in this
   * repository is — `BoqNode` carries no organization column of its own.
   */
  async findLeafValues(prisma: TenantPrisma, projectId: string, boqNodeIds: string[]) {
    if (boqNodeIds.length === 0) return [];
    return prisma.boqNode.findMany({
      where: { id: { in: boqNodeIds }, version: { boq: { projectId } } },
      select: { id: true, totalAmount: true },
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

  /**
   * Master Schedule P4 (ADR-029): the project + org identity for the branded PDF header, in one
   * tenant-scoped read. Resolves the client name from the linked Client (falling back to the
   * free-text clientName) and the org branding (name + logoUrl) via the project→organization
   * relation. Prisma stays behind the repo (Clean Architecture).
   */
  findProjectHeader(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.project.findFirst({
      where: { id: projectId, organizationId },
      select: {
        code: true,
        name: true,
        clientName: true,
        startDate: true,
        expectedEndDate: true,
        client: { select: { name: true } },
        organization: { select: { name: true, logoUrl: true } },
      },
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
