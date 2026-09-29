import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import {
  DprStatus,
  type RequestIdentity,
  type ApplyScheduleTemplateResponse,
  type CollectionProgressSignalResponse,
  type PhysicalFinancialSignalResponse,
  type ProgressActualPoint,
  type ProgressCurvePoint,
  type ProgressCurveResponse,
  type ProgressCurveSource,
  type ProgressPeriodComparisonResponse,
  type ProgressScheduleStatus,
  type ProgressSnapshotResponse,
  type ScheduleTemplateKey,
  type SuggestWeightsResponse,
} from '@erp/types';

import { isoDate, scheduleStatusFor } from '../domain/progress-curve.js';
import { classifyDivergence } from '../domain/divergence.js';
import { validateDeliveryPlanBatch, type DeliveryPlanPackageInput } from '../domain/delivery-plan.js';
import {
  DPR_EXCEEDS_BOQ_QUANTITY,
  findOverQuantityLines,
  overQuantityMessage,
  type OverQuantityInput,
} from '../domain/over-quantity.js';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProgressRepository } from '../infrastructure/progress.repository.js';
import { ProgrammeBaselineRepository } from '../infrastructure/programme-baseline.repository.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { ProjectFinancialPositionService } from '../../../accounting/financial-position/application/project-financial-position.service.js';
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';
import {
  leafPercentComplete,
  packagePercentComplete,
  progressValueByLeaf,
  weightedPackagePercent,
} from '../domain/progress-rollup.js';
import { scheduleTemplateCode, scheduleTemplatePhases } from '../domain/schedule-templates.js';
// The single server-owned money-visibility definition (ADR-029 §8 A-2) — reused, not re-derived, so
// the Progress signals hide money from exactly the roles the BOQ and Commercial read models do.
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';

const ZERO = new Decimal(0);

/** Wire code for a BOQ leaf that is already allocated to a work package (CONST-PROG-012). */
export const BOQ_ITEM_ALREADY_ALLOCATED = 'BOQ_ITEM_ALREADY_ALLOCATED';

function boqItemAlreadyAllocated(): ConflictException {
  return new ConflictException({
    message:
      'This BOQ item is already allocated to another work package. Refresh the plan and pick an unallocated item.',
    errorCode: BOQ_ITEM_ALREADY_ALLOCATED,
  });
}

/**
 * True when a write hit the work-package allocation table's unique leaf index
 * (`WorkPackageBoqNode @@unique([boqNodeId])`) — a leaf allocated by a racing request between our
 * pre-check and the insert. Prisma reports P2002 with either `meta.modelName` or a `meta.target`
 * that is a column array (`['boq_node_id']`) or the constraint name as a string
 * (`work_package_boq_nodes_boq_node_id_key`) depending on version and query path, so any of those
 * counts. A P2002 on another model (e.g. the package code) propagates unchanged.
 */
function isLeafAllocationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = (error.meta ?? {}) as { modelName?: unknown; target?: unknown };
  if (meta.modelName === 'WorkPackageBoqNode') return true;
  const target = Array.isArray(meta.target) ? meta.target.join(',') : String(meta.target ?? '');
  return /work_package_boq_nodes|boq_node_id|boqNodeId/.test(target);
}

// ADR-021: the statuses in which a DPR's measurements may be added/edited and it can be submitted —
// a fresh draft, one returned before approval, or one reopened for correction (CONST-PROG-010).
function isEditableDprStatus(status: string): boolean {
  return status === DprStatus.DRAFT || status === DprStatus.RETURNED || status === DprStatus.REOPENED;
}

/**
 * Evidence may be added while the report is editable AND while it is SUBMITTED (the Progress UI
 * lets the preparer / reviewer add photos during review — `canUpload = !isApproved`). It is closed
 * once APPROVED: approval freezes the evidence set (CONST-PROG-008).
 */
function canAttachEvidence(status: string): boolean {
  return isEditableDprStatus(status) || status === DprStatus.SUBMITTED;
}

function evidenceClosed(status: string): ConflictException {
  return new ConflictException(
    `Evidence can no longer be added to this report (it is ${status}). Reopen it to add corrections.`,
  );
}

/** 409 when a report moved between our read and our write (a concurrent command won). */
function reportChanged(action: string): ConflictException {
  return new ConflictException({
    message: `This report changed while you were ${action} it — reload it and try again.`,
    errorCode: 'DPR_CHANGED',
  });
}

/** Locked DPR transactions give up after this long rather than hold rows indefinitely. */
const LOCKED_TX_TIMEOUT_MS = 15000; // same bound as the commercial billing transactions

/**
 * True for lock contention on a locked DPR transaction: Prisma's interactive-transaction timeout
 * (P2028), a write conflict / deadlock (P2034), or Postgres deadlock_detected (40P01) surfaced
 * through a raw query (P2010 with meta.code) or in the message.
 */
function isLockContention(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return error instanceof Error && error.message.includes('40P01');
  }
  if (error.code === 'P2028' || error.code === 'P2034') return true;
  const metaCode = (error.meta as { code?: unknown } | undefined)?.code;
  return metaCode === '40P01' || error.message.includes('40P01');
}

/** 409 when a locked DPR transaction timed out or deadlocked — safe to retry. */
function reportBusy(): ConflictException {
  return new ConflictException({
    message: 'This report is busy — try again.',
    errorCode: 'DPR_CHANGED',
  });
}

/** Run a delete; a row that vanished between our read and the delete (P2025) is a plain 404. */
async function deleteOr404<T>(write: Promise<T>, notFoundMessage: string): Promise<T> {
  try {
    return await write;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
      throw new NotFoundException(notFoundMessage);
    }
    throw error;
  }
}

/** ADR-022 CONST-DOA-008 SoD: the preparer or submitter cannot approve their own report. */
function assertNotSelfApproval(
  dpr: { preparedBy: string; submittedBy: string | null },
  userId: string,
): void {
  // Applies to reopened reports too — reopening and re-submitting does not reset the check.
  if (dpr.preparedBy === userId || dpr.submittedBy === userId) {
    throw new ForbiddenException(
      'A preparer or submitter cannot approve their own daily progress report.',
    );
  }
}

export interface CreateDprDto {
  reportDate: string;
  weather?: string;
  labourCount?: number;
  equipmentNote?: string;
  narrative?: string;
  delayReason?: string;
}
export interface AddMeasurementDto {
  boqNodeId: string;
  quantity: number;
  notes?: string;
  locationArea?: string;
}

/**
 * ADR-021 Progress MVP. A DPR is the daily evidence container; the measurements inside it become
 * verified only when the DPR is APPROVED (CONST-PROG-008). Cumulative verified quantity per BOQ leaf
 * cannot exceed the leaf's measurable quantity (CONST-PROG-002/009). Approved reports are immutable.
 */
@Injectable()
export class ProgressService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProgressRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly financialPosition: ProjectFinancialPositionService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly files: PlatformFileService,
    // Master Schedule P3 (ADR-029): the read-side source of the governing frozen baseline. The
    // variance engine measures against this once a baseline is approved; before that it reads the
    // live targets. Prisma stays behind the repo (Clean Architecture).
    private readonly baselineRepo: ProgrammeBaselineRepository,
  ) {}

  async createDpr(identity: RequestIdentity, projectId: string, dto: CreateDprDto) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.createDpr(this.tenancy.getClient(), {
      organizationId: identity.activeOrganizationId,
      projectId,
      reportDate: new Date(dto.reportDate),
      weather: dto.weather ?? null,
      labourCount: dto.labourCount ?? null,
      equipmentNote: dto.equipmentNote ?? null,
      narrative: dto.narrative ?? null,
      delayReason: dto.delayReason ?? null,
      preparedBy: identity.userId,
    });
  }

  private async requireDpr(identity: RequestIdentity, dprId: string) {
    const prisma = this.tenancy.getClient();
    const dpr = await this.repo.findDpr(prisma, identity.activeOrganizationId, dprId);
    if (!dpr) throw new NotFoundException(`Daily report ${dprId} not found`);
    await this.projectAccess.assertMember(identity, dpr.projectId);
    return dpr;
  }

  async addMeasurement(identity: RequestIdentity, dprId: string, dto: AddMeasurementDto) {
    const prisma = this.tenancy.getClient();
    const dpr = await this.requireDpr(identity, dprId);
    if (!isEditableDprStatus(dpr.status)) {
      throw new BadRequestException('Measurements can only be added to a DRAFT, RETURNED or REOPENED report.');
    }
    if (!(dto.quantity > 0)) throw new BadRequestException('Quantity must be greater than 0.');

    const node = await this.repo.findBoqNodeForProject(prisma, dpr.projectId, dto.boqNodeId);
    if (!node) throw new NotFoundException('BOQ node not found for this project.');
    if (!node.isLeaf) throw new BadRequestException('Measure against a BOQ leaf item, not a section.');

    return this.inLockedEditableDpr(
      identity,
      dprId,
      () =>
        new BadRequestException('Measurements can only be added to a DRAFT, RETURNED or REOPENED report.'),
      (tx) =>
        this.repo.addMeasurement(tx, {
          organizationId: identity.activeOrganizationId,
          dprId,
          boqNodeId: dto.boqNodeId,
          quantity: dto.quantity,
          notes: dto.notes ?? null,
          locationArea: dto.locationArea ?? null,
          createdBy: identity.userId,
        }),
    );
  }

  /**
   * Remove a work entry from a report still in the preparer's hands (DRAFT / RETURNED / REOPENED) —
   * e.g. a typo'd quantity. Once submitted or approved the entry is under review / verified, so the
   * delete is refused with 409. Evidence tagged to the entry is NOT deleted: the schema's SetNull
   * on `DprAttachment.measurementId` detaches it, so the file stays on the report as general
   * evidence (removing a tag never destroys evidence).
   */
  async removeMeasurement(identity: RequestIdentity, dprId: string, measurementId: string) {
    await this.requireDpr(identity, dprId);
    return this.inLockedEditableDpr(
      identity,
      dprId,
      (status) =>
        new ConflictException(
          `Work entries can only be removed from a DRAFT, RETURNED or REOPENED report (is ${status}).`,
        ),
      async (tx, dpr) => {
        const entry = dpr.measurements.find((m) => m.id === measurementId);
        if (!entry) {
          throw new NotFoundException(`Work entry ${measurementId} not found on this report.`);
        }
        // CONST-PROG-010 supersede, don't overwrite: in a reopened report the entries that were
        // approved are part of the record. Only entries added since the reopen may be deleted.
        if (
          dpr.status === DprStatus.REOPENED &&
          dpr.reopenedAt &&
          entry.createdAt.getTime() <= dpr.reopenedAt.getTime()
        ) {
          throw new ConflictException(
            'This work entry was part of the approved report, so it cannot be deleted while the report is reopened. Add a correcting entry instead.',
          );
        }
        return deleteOr404(
          this.repo.deleteMeasurement(tx, measurementId),
          `Work entry ${measurementId} not found on this report.`,
        );
      },
    );
  }

  async attachEvidence(
    identity: RequestIdentity,
    dprId: string,
    platformFileId: string,
    measurementId?: string,
  ) {
    const prisma = this.tenancy.getClient();
    const dpr = await this.requireDpr(identity, dprId);
    if (!canAttachEvidence(dpr.status)) throw evidenceClosed(dpr.status);
    const file = await this.repo.findFileStatus(prisma, identity.activeOrganizationId, platformFileId);
    if (!file) throw new NotFoundException(`File ${platformFileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The evidence file must be fully uploaded (READY).');
    }
    if (measurementId) {
      const belongs = dpr.measurements.some((m) => m.id === measurementId);
      if (!belongs) throw new BadRequestException('That work entry does not belong to this report.');
    }
    // Under the DPR row lock, so evidence cannot land on a report an approval has just frozen:
    // either it is attached first (and frozen with the rest) or it sees APPROVED and is refused.
    const attachment = await this.inLockedEditableDpr(
      identity,
      dprId,
      evidenceClosed,
      async (tx, fresh) => {
        if (measurementId && !fresh.measurements.some((m) => m.id === measurementId)) {
          throw new BadRequestException('That work entry does not belong to this report.');
        }
        return this.repo.createAttachment(tx, {
          dprId,
          platformFileId,
          measurementId: measurementId ?? null,
          createdBy: identity.userId,
        });
      },
      canAttachEvidence,
    );
    // Binding takes the file out of reach of the abandoned-upload sweep and of DELETE /files/:id:
    // from here it is evidence on a report, and only the report can release it.
    await this.files.bind(platformFileId, `DPR evidence ${attachment.id}`);
    return attachment;
  }

  // ─── Phase 3: structured DPR row CRUD ─────────────────────────────────────────

  /** Patch context fields (Section A + tomorrow plan) on an editable DPR. */
  async patchDprContext(
    identity: RequestIdentity,
    dprId: string,
    dto: {
      locationArea?: string;
      shift?: string;
      tomorrowPlan?: string;
      weather?: string;
      labourCount?: number;
      equipmentNote?: string;
      narrative?: string;
      delayReason?: string;
    },
  ) {
    const dpr = await this.requireDpr(identity, dprId);
    if (!isEditableDprStatus(dpr.status)) {
      throw new BadRequestException('Context fields can only be updated on a DRAFT, RETURNED or REOPENED report.');
    }
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () =>
        new BadRequestException('Context fields can only be updated on a DRAFT, RETURNED or REOPENED report.'),
      (tx) => this.repo.patchDprContext(tx, dprId, dto),
    );
  }

  async addLabourRow(identity: RequestIdentity, dprId: string, dto: { trade: string; headcount: number; contractor?: string; hours?: number }) {
    const dpr = await this.requireDpr(identity, dprId);
    if (!isEditableDprStatus(dpr.status)) {
      throw new BadRequestException('Labour rows can only be added to a DRAFT, RETURNED or REOPENED report.');
    }
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () => new BadRequestException('Labour rows can only be added to a DRAFT, RETURNED or REOPENED report.'),
      (tx) =>
        this.repo.addLabourRow(tx, {
          dprId,
          trade: dto.trade,
          headcount: dto.headcount,
          contractor: dto.contractor ?? null,
          hours: dto.hours ?? null,
        }),
    );
  }

  async removeLabourRow(identity: RequestIdentity, dprId: string, rowId: string) {
    const prisma = this.tenancy.getClient();
    const row = await this.repo.findLabourRow(prisma, rowId);
    if (!row || row.dprId !== dprId) throw new NotFoundException(`Labour row ${rowId} not found on this report.`);
    await this.requireDpr(identity, dprId);
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () =>
        new BadRequestException('Labour rows can only be removed from a DRAFT, RETURNED or REOPENED report.'),
      (tx) => deleteOr404(this.repo.deleteLabourRow(tx, rowId), `Labour row ${rowId} not found on this report.`),
    );
  }

  async addEquipmentRow(
    identity: RequestIdentity,
    dprId: string,
    dto: { equipmentType: string; count: number; hoursWorked?: number; condition?: string; notes?: string },
  ) {
    const dpr = await this.requireDpr(identity, dprId);
    if (!isEditableDprStatus(dpr.status)) {
      throw new BadRequestException('Equipment rows can only be added to a DRAFT, RETURNED or REOPENED report.');
    }
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () =>
        new BadRequestException('Equipment rows can only be added to a DRAFT, RETURNED or REOPENED report.'),
      (tx) =>
        this.repo.addEquipmentRow(tx, {
          dprId,
          equipmentType: dto.equipmentType,
          count: dto.count,
          hoursWorked: dto.hoursWorked ?? null,
          condition: dto.condition ?? null,
          notes: dto.notes ?? null,
        }),
    );
  }

  async removeEquipmentRow(identity: RequestIdentity, dprId: string, rowId: string) {
    const prisma = this.tenancy.getClient();
    const row = await this.repo.findEquipmentRow(prisma, rowId);
    if (!row || row.dprId !== dprId) throw new NotFoundException(`Equipment row ${rowId} not found on this report.`);
    await this.requireDpr(identity, dprId);
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () =>
        new BadRequestException('Equipment rows can only be removed from a DRAFT, RETURNED or REOPENED report.'),
      (tx) =>
        deleteOr404(this.repo.deleteEquipmentRow(tx, rowId), `Equipment row ${rowId} not found on this report.`),
    );
  }

  async addObservation(
    identity: RequestIdentity,
    dprId: string,
    dto: { category: string; description: string; affectedWork?: string; severity?: string; followUpOwner?: string },
  ) {
    const dpr = await this.requireDpr(identity, dprId);
    if (!isEditableDprStatus(dpr.status)) {
      throw new BadRequestException('Observations can only be added to a DRAFT, RETURNED or REOPENED report.');
    }
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () => new BadRequestException('Observations can only be added to a DRAFT, RETURNED or REOPENED report.'),
      (tx) =>
        this.repo.addObservation(tx, {
          dprId,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          category: dto.category as any,
          description: dto.description,
          affectedWork: dto.affectedWork ?? null,
          severity: dto.severity ?? null,
          followUpOwner: dto.followUpOwner ?? null,
        }),
    );
  }

  async removeObservation(identity: RequestIdentity, dprId: string, obsId: string) {
    const prisma = this.tenancy.getClient();
    const obs = await this.repo.findObservation(prisma, obsId);
    if (!obs || obs.dprId !== dprId) throw new NotFoundException(`Observation ${obsId} not found on this report.`);
    await this.requireDpr(identity, dprId);
    return this.inLockedEditableDpr(
      identity,
      dprId,
      () =>
        new BadRequestException('Observations can only be removed from a DRAFT, RETURNED or REOPENED report.'),
      (tx) => deleteOr404(this.repo.deleteObservation(tx, obsId), `Observation ${obsId} not found on this report.`),
    );
  }

  // ─── End Phase 3 ───────────────────────────────────────────────────────────────

  async submit(identity: RequestIdentity, dprId: string) {
    const dpr = await this.requireDpr(identity, dprId);
    if (!isEditableDprStatus(dpr.status)) {
      throw new BadRequestException(`Cannot submit a ${dpr.status} report.`);
    }
    // Catch an over-quantity entry while the report is still in the preparer's hands, rather than
    // letting it bounce at approval. Approve re-runs the same check and stays authoritative.
    await this.assertWithinBoqQuantity(identity, dpr);
    // Conditional on the status we read, so a submit cannot overwrite a concurrent transition.
    return this.transition(this.tenancy.getClient(), dprId, dpr.status, 'submitting', {
      status: DprStatus.SUBMITTED,
      submittedBy: identity.userId,
      submittedAt: new Date(),
    });
  }

  /**
   * Approve → measurements become verified. Race-safe (CONST-PROG-002/008/009):
   *  - fast, unlocked pre-checks (status, SoD, governance gate, over-quantity) fail the common
   *    mistakes early;
   *  - then ONE transaction takes locks in a fixed order — the DPR row, then its BOQ leaves sorted by
   *    id — re-reads the report (status, preparer/submitter, measurements) from the transaction, and
   *    re-runs SoD and the over-quantity check on that fresh read. A return + edit + resubmit that
   *    slipped in after the pre-check is therefore checked, not the stale copy;
   *  - evidence is frozen and the status flipped inside the same transaction; the flip is conditional
   *    on the report still being SUBMITTED, so a concurrent approve/return loses with 409.
   */
  async approve(identity: RequestIdentity, dprId: string) {
    const pre = await this.requireDpr(identity, dprId);
    if (pre.status !== DprStatus.SUBMITTED) {
      // 409, like the in-transaction re-check: the report is not (or no longer) awaiting approval.
      throw new ConflictException({
        message: `Only a SUBMITTED report can be approved (is ${pre.status}) — reload it.`,
        errorCode: 'DPR_CHANGED',
      });
    }
    assertNotSelfApproval(pre, identity.userId);

    // ADR-022 CONST-DOA-008 governance seam: a DPR is approved by the Project Manager. With no
    // active binding this resolves to null and approval proceeds unchanged; an active binding
    // opens the approval instance and returns 409 for the client to drive (backward-compatible).
    // A read + possible instance creation, so it stays outside the approve transaction.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        'DailyProgressReport',
        'SUBMITTED',
        'APPROVED',
        dprId,
      ),
      'Approving this progress report requires workflow approval.',
    );

    // Fast, unlocked pre-check: fail an obviously over-quantity report before opening the transaction.
    await this.assertWithinBoqQuantity(identity, pre);

    return this.lockedTx(async (tx) => {
      // Lock order: DPR row first, then BOQ leaves by id — every approver takes them the same way.
      const dpr = await this.lockAndReadDpr(tx, identity, dprId);
      if (dpr.status !== DprStatus.SUBMITTED) throw reportChanged('approving');
      assertNotSelfApproval(dpr, identity.userId);

      const nodeIds = [...new Set(dpr.measurements.map((m) => m.boqNodeId))].sort();
      await this.repo.lockBoqNodes(tx, nodeIds);
      await this.assertWithinBoqQuantity(identity, dpr, tx);

      // CONST-PROG-008: approval is what makes these measurements verified, so from here the
      // evidence behind them is part of the record. A REOPENED correction appends new evidence; it
      // never releases the old (supersede, don't overwrite). Frozen in the same transaction as the
      // status flip: either both happen or neither.
      const evidence = await this.repo.findAttachmentFileIds(tx, dprId);
      await this.files.markManyImmutable(evidence, `evidence on approved report ${dprId}`, tx);

      return this.transition(tx, dprId, DprStatus.SUBMITTED, 'approving', {
        status: DprStatus.APPROVED,
        approvedBy: identity.userId,
        approvedAt: new Date(),
      });
    });
  }

  /** Lock the DPR row for the rest of the transaction, then read it fresh through the transaction. */
  private async lockAndReadDpr(
    tx: ReturnType<TenancyService['getClient']>,
    identity: RequestIdentity,
    dprId: string,
  ) {
    const locked = await this.repo.lockDpr(tx, identity.activeOrganizationId, dprId);
    const dpr = locked ? await this.repo.findDpr(tx, identity.activeOrganizationId, dprId) : null;
    if (!dpr) throw new NotFoundException(`Daily report ${dprId} not found`);
    return dpr;
  }

  /**
   * Conditional status change: applies only if the report is still in `from`, else 409 — the report
   * moved under us (a concurrent approve / return / reopen / submit). Returns the updated row.
   */
  private async transition(
    prisma: ReturnType<TenancyService['getClient']>,
    dprId: string,
    from: string,
    action: string,
    data: Prisma.DailyProgressReportUncheckedUpdateManyInput,
  ) {
    const count = await this.repo.transitionDprStatus(prisma, dprId, from, data);
    if (count !== 1) throw reportChanged(action);
    return this.repo.findDprRow(prisma, dprId);
  }

  /**
   * Run a row-level edit of an editable report under the DPR row lock, re-checking the editable
   * status on a fresh read — so an edit cannot land after a concurrent submit / approve.
   */
  private async inLockedEditableDpr<T>(
    identity: RequestIdentity,
    dprId: string,
    notEditable: (status: string) => Error,
    fn: (
      tx: ReturnType<TenancyService['getClient']>,
      dpr: Awaited<ReturnType<ProgressService['lockAndReadDpr']>>,
    ) => Promise<T>,
    allowed: (status: string) => boolean = isEditableDprStatus,
  ): Promise<T> {
    return this.lockedTx(async (tx) => {
      const dpr = await this.lockAndReadDpr(tx, identity, dprId);
      if (!allowed(dpr.status)) throw notEditable(dpr.status);
      return fn(tx, dpr);
    });
  }

  /**
   * An interactive transaction for the DPR row-locking paths: bounded by LOCKED_TX_TIMEOUT_MS, and
   * lock contention (timeout / deadlock) surfaces as a retryable 409 instead of a 500.
   */
  private async lockedTx<T>(
    fn: (tx: ReturnType<TenancyService['getClient']>) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.tenancy
        .getClient()
        .$transaction(async (txClient) => fn(txClient as never), { timeout: LOCKED_TX_TIMEOUT_MS });
    } catch (error) {
      if (isLockContention(error)) throw reportBusy();
      throw error;
    }
  }

  /**
   * CONST-PROG-002/009: cumulative verified quantity per BOQ leaf may not exceed the leaf's
   * measurable quantity. Sums this report's measurements per line, adds what OTHER approved reports
   * have verified, and — when any line would go over — throws 400 `DPR_EXCEEDS_BOQ_QUANTITY` with
   * every offending line in `details.lines` and a message naming the first one.
   */
  private async assertWithinBoqQuantity(
    identity: RequestIdentity,
    dpr: {
      id: string;
      projectId: string;
      measurements: { boqNodeId: string; quantity: { toString(): string } }[];
    },
    // The approve transaction passes its client so the reads see the rows it has locked.
    client?: ReturnType<TenancyService['getClient']>,
  ): Promise<void> {
    const prisma = client ?? this.tenancy.getClient();
    const byNode = new Map<string, Decimal>();
    for (const m of dpr.measurements) {
      byNode.set(m.boqNodeId, (byNode.get(m.boqNodeId) ?? ZERO).plus(new Decimal(m.quantity.toString())));
    }

    const inputs: OverQuantityInput[] = [];
    for (const [nodeId, thisReport] of byNode) {
      const node = await this.repo.findBoqNodeForProject(prisma, dpr.projectId, nodeId);
      const prior = await this.repo.sumVerifiedForNode(
        prisma,
        identity.activeOrganizationId,
        nodeId,
        dpr.id,
      );
      inputs.push({
        boqNodeId: nodeId,
        boqCode: node?.code ?? null,
        description: node?.description ?? null,
        unit: node?.unit ?? null,
        boqQuantity: new Decimal(node?.quantity?.toString() ?? '0'),
        verifiedToDate: new Decimal(prior._sum.quantity?.toString() ?? '0'),
        thisReport,
      });
    }

    const lines = findOverQuantityLines(inputs);
    if (lines.length > 0) {
      throw new BadRequestException({
        message: overQuantityMessage(lines),
        errorCode: DPR_EXCEEDS_BOQ_QUANTITY,
        details: { lines },
      });
    }
  }

  async returnForRevision(identity: RequestIdentity, dprId: string, reason: string) {
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== DprStatus.SUBMITTED) {
      throw new BadRequestException('Only a SUBMITTED report can be returned.');
    }
    // returnedBy/At record the most recent return alongside returnReason; like the reason, a
    // resubmit keeps them and the next return overwrites them.
    // Conditional: a return racing an approve cannot leave an APPROVED report RETURNED (or vice versa).
    return this.transition(this.tenancy.getClient(), dprId, DprStatus.SUBMITTED, 'returning', {
      status: DprStatus.RETURNED,
      returnReason: reason,
      returnedBy: identity.userId,
      returnedAt: new Date(),
    });
  }

  /**
   * ADR-021 CONST-PROG-010 — a controlled, authorised, audited reopen of an APPROVED report for
   * correction. Moves it to REOPENED (editable + re-submittable), records who reopened it and why,
   * and — because only APPROVED measurements count as verified — its progress contribution drops out
   * of the roll-up until it is re-approved. No silent edits: an approved report can be corrected only
   * through this path.
   */
  async reopen(identity: RequestIdentity, dprId: string, reason: string) {
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== DprStatus.APPROVED) {
      throw new BadRequestException(`Only an APPROVED report can be reopened (is ${dpr.status}).`);
    }

    // ADR-022 CONST-DOA-008 governance seam: reopening a trusted APPROVED report is a governed
    // command. With no active binding this resolves to null and the reopen proceeds unchanged; an
    // active binding opens the approval instance and returns 409 for the client to drive.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(
        identity,
        'DailyProgressReport',
        'APPROVED',
        'REOPENED',
        dprId,
      ),
      'Reopening this progress report requires workflow approval.',
    );

    return this.transition(this.tenancy.getClient(), dprId, DprStatus.APPROVED, 'reopening', {
      status: DprStatus.REOPENED,
      reopenedBy: identity.userId,
      reopenedAt: new Date(),
      reopenReason: reason,
    });
  }

  async listDprs(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const dprs = await this.repo.findDprsByProject(prisma, identity.activeOrganizationId, projectId);
    return this.withReadModelFields(identity, dprs);
  }

  async getDpr(identity: RequestIdentity, dprId: string) {
    const dpr = await this.requireDpr(identity, dprId);
    const [enriched] = await this.withReadModelFields(identity, [dpr]);
    return enriched!;
  }

  /**
   * Read-model enrichment shared by the DPR list and detail, batched for the whole set:
   *  - one users query resolves preparedByName / approvedByName / returnedByName / reviewedByName
   *    (the reviewer is the approver for APPROVED, the reopener for REOPENED, the returner for
   *    RETURNED);
   *  - one measurements query resolves `workPackages` — the distinct work packages the report's
   *    measured BOQ leaves are allocated to, ordered by code.
   */
  private async withReadModelFields<
    T extends {
      id: string;
      status: string;
      preparedBy: string;
      approvedBy: string | null;
      returnedBy: string | null;
      reopenedBy: string | null;
    },
  >(identity: RequestIdentity, dprs: T[]) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const [names, packageRows] = await Promise.all([
      this.resolveUserNames(
        prisma,
        orgId,
        dprs.flatMap((d) => [
          d.preparedBy,
          d.approvedBy ?? '',
          d.returnedBy ?? '',
          d.reopenedBy ?? '',
        ]),
      ),
      this.repo.findWorkPackagesForDprs(
        prisma,
        orgId,
        dprs.map((d) => d.id),
      ),
    ]);

    const packagesByDpr = new Map<string, Map<string, { id: string; code: string; name: string }>>();
    for (const row of packageRows) {
      const byId = packagesByDpr.get(row.dprId) ?? new Map();
      for (const link of row.boqNode.workPackageLinks) byId.set(link.workPackage.id, link.workPackage);
      packagesByDpr.set(row.dprId, byId);
    }
    const nameOf = (id: string | null) => (id ? names.get(id) : undefined);

    return dprs.map((d) => {
      // The latest reviewer: the approver of an APPROVED report, the reopener of a REOPENED one,
      // the returner of a RETURNED one; nobody yet for DRAFT / SUBMITTED.
      const reviewer =
        d.status === DprStatus.APPROVED
          ? d.approvedBy
          : d.status === DprStatus.REOPENED
            ? d.reopenedBy
            : d.status === DprStatus.RETURNED
              ? d.returnedBy
              : null;
      return {
        ...d,
        preparedByName: names.get(d.preparedBy),
        approvedByName: nameOf(d.approvedBy),
        returnedByName: nameOf(d.returnedBy),
        reviewedByName: nameOf(reviewer),
        workPackages: [...(packagesByDpr.get(d.id)?.values() ?? [])].sort((a, b) =>
          a.code.localeCompare(b.code),
        ),
      };
    });
  }

  /**
   * Batch id→"firstName lastName" resolution for the DPR read models. Collects distinct ids, does a
   * single tenant-scoped users lookup (Prisma stays in the repo), and returns a Map. An unresolved id
   * is simply absent from the map (the caller leaves preparedByName undefined) — never throws.
   */
  private async resolveUserNames(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    ids: string[],
  ): Promise<Map<string, string>> {
    const distinct = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    const users = await this.repo.findUserNamesByIds(prisma, organizationId, distinct);
    return new Map<string, string>(
      users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()] as const),
    );
  }

  /** Verified physical progress per BOQ leaf (from APPROVED DPRs only). */
  async getProjectProgress(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const rows = await this.repo.approvedMeasurementsForProject(prisma, identity.activeOrganizationId, projectId);

    const byNode = new Map<
      string,
      { code: string; description: string; quantity: Decimal; verified: Decimal }
    >();
    for (const m of rows) {
      const e =
        byNode.get(m.boqNodeId) ??
        {
          code: m.boqNode.code,
          description: m.boqNode.description,
          quantity: new Decimal(m.boqNode.quantity?.toString() ?? '0'),
          verified: ZERO,
        };
      e.verified = e.verified.plus(new Decimal(m.quantity.toString()));
      byNode.set(m.boqNodeId, e);
    }

    return [...byNode.entries()].map(([boqNodeId, e]) => ({
      boqNodeId,
      code: e.code,
      description: e.description,
      measurableQuantity: e.quantity.toString(),
      verifiedToDate: e.verified.toString(),
      percentComplete: leafPercentComplete(e.verified, e.quantity),
    }));
  }

  // ─── Work packages + roll-up (ADR-021 CONST-PROG-005/007) ─────────────────────────

  async createWorkPackage(identity: RequestIdentity, projectId: string, dto: CreateWorkPackageDto) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.createWorkPackage(this.tenancy.getClient(), {
      organizationId: identity.activeOrganizationId,
      projectId,
      code: dto.code,
      name: dto.name,
      responsibleOwner: dto.responsibleOwner ?? null,
      progressWeight: dto.progressWeight ?? 0,
      createdBy: identity.userId,
    });
  }

  async allocateBoqNode(identity: RequestIdentity, workPackageId: string, boqNodeId: string) {
    const prisma = this.tenancy.getClient();
    const wp = await this.repo.findWorkPackageById(prisma, identity.activeOrganizationId, workPackageId);
    if (!wp) throw new NotFoundException(`Work package ${workPackageId} not found`);
    await this.projectAccess.assertMember(identity, wp.projectId);

    const node = await this.repo.findBoqNodeForProject(prisma, wp.projectId, boqNodeId);
    if (!node) throw new NotFoundException('BOQ node not found for this project.');
    if (!node.isLeaf) throw new BadRequestException('Allocate a BOQ leaf item, not a section.');

    // CONST-PROG-012: a leaf belongs to at most one work package, so its verified progress is
    // counted once in the roll-up. Surface the clash rather than let the unique index 500.
    const existing = await this.repo.findLeafAllocation(prisma, boqNodeId);
    if (existing && existing.workPackageId !== workPackageId) {
      throw boqItemAlreadyAllocated();
    }

    try {
      return await this.repo.allocateBoqNode(prisma, workPackageId, boqNodeId);
    } catch (error) {
      // A racing allocation of the same leaf landed between the check above and this insert.
      if (isLeafAllocationConflict(error)) throw boqItemAlreadyAllocated();
      throw error;
    }
  }

  async listWorkPackages(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const packages = await this.repo.findWorkPackages(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
    );
    // `boqNodeIds` is the client-facing shape of the `boqLinks` join rows — named for what it is
    // (Delivery Plan's suggestion engine needs the actual allocated leaf ids, not just a count, to
    // know which BOQ leaves are already spoken for) rather than leaking the Prisma relation shape.
    return packages.map((wp) => ({
      ...wp,
      boqNodeIds: wp.boqLinks.map((link) => link.boqNodeId),
    }));
  }

  /**
   * Delivery Plan batch save: create every reviewed package AND its leaf allocations together,
   * all-or-nothing. The frontend proposes packages from the BOQ tree and lets the PM edit them
   * freely — nothing here is a suggestion by the time it reaches this method, and NOTHING is
   * persisted until this call succeeds in full.
   *
   * Two validation passes, deliberately in this order:
   *  1. `validateDeliveryPlanBatch` (pure, no I/O) against what already exists — catches the
   *     ordinary mistakes (blank fields, reused codes, a leaf assigned twice) with one clear
   *     message per problem, before any write is attempted.
   *  2. The write itself runs in ONE `prisma.$transaction`. A leaf's `@@unique([boqNodeId])`
   *     constraint is the final backstop against a race (two PMs saving overlapping plans at the
   *     same moment) that step 1 cannot see — if it fires, Prisma rolls back everything the
   *     transaction had written so far, so the project never ends up with some packages created
   *     and others missing. This is the same all-or-nothing pattern `applyScheduleTemplate` (P1-d)
   *     already uses for seeding phases from a template; this batches allocations onto it too.
   */
  async saveDeliveryPlan(identity: RequestIdentity, projectId: string, dto: SaveDeliveryPlanDto) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const allLeafIds = [...new Set(dto.packages.flatMap((pkg) => pkg.boqNodeIds))];
    const nodes = await this.repo.findBoqNodesForAllocation(prisma, projectId, allLeafIds);
    const foundIds = new Set(nodes.map((n) => n.id));
    const missingIds = allLeafIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new BadRequestException(
        `${missingIds.length} BOQ item(s) in this plan were not found in this project's BOQ.`,
      );
    }
    const nonLeafIds = nodes.filter((n) => !n.isLeaf).map((n) => n.id);
    if (nonLeafIds.length > 0) {
      throw new BadRequestException('Only BOQ leaf items can be allocated to a package, not sections.');
    }

    const existingPackages = await this.repo.findWorkPackages(
      prisma,
      identity.activeOrganizationId,
      projectId,
    );
    const existingCodes = new Set(existingPackages.map((wp) => wp.code));
    const existingAllocatedLeafIds = new Set(
      existingPackages.flatMap((wp) => wp.boqLinks.map((link) => link.boqNodeId)),
    );

    const errors = validateDeliveryPlanBatch(dto.packages, existingCodes, existingAllocatedLeafIds);
    if (errors.length > 0) {
      throw new BadRequestException(errors.map((e) => e.message).join(' '));
    }

    const created = await prisma.$transaction(async (tx) => {
      const packages = await Promise.all(
        dto.packages.map((pkg) =>
          this.repo.createWorkPackage(tx as never, {
            organizationId: identity.activeOrganizationId,
            projectId,
            code: pkg.code,
            name: pkg.name,
            responsibleOwner: pkg.responsibleOwner ?? null,
            progressWeight: pkg.progressWeight ?? 0,
            createdBy: identity.userId,
          }),
        ),
      );
      await Promise.all(
        packages.flatMap((wp, index) =>
          dto.packages[index]!.boqNodeIds.map((leafId) =>
            this.repo.allocateBoqNode(tx as never, wp.id, leafId),
          ),
        ),
      );
      return packages;
    }).catch((error: unknown) => {
      // The unique-leaf backstop fired: another plan claimed a leaf after validation. The whole
      // transaction has rolled back; tell the caller plainly rather than surfacing a raw 500.
      if (isLeafAllocationConflict(error)) throw boqItemAlreadyAllocated();
      throw error;
    });

    return {
      projectId,
      packages: created.map((wp) => ({ id: wp.id, code: wp.code, name: wp.name })),
    };
  }

  /**
   * Master Schedule P1-d (ADR-029): seed a project's phases from a server-side schedule template so
   * the guided setup wizard starts from a real programme, not an empty grid. Each template phase
   * becomes a work package — reusing the same `repo.createWorkPackage` write the manual create uses,
   * inside ONE transaction so a project's phases are all-or-nothing. Codes are auto-numbered
   * WP-01…WP-09 in template order (that order IS the sequence, since the read model sorts by code);
   * `durationDays` and `scheduleOnly` come from the template; `progressWeight` starts at 0 and the
   * planned dates start null — the wizard fills those in later (weights via `suggestWeights`, dates
   * via the WP PATCH).
   *
   * Guard: only a project with ZERO work packages may be seeded. A project that already has any
   * returns 409 rather than silently duplicating a second set of phases (an "append" mode is a later
   * option, per the spec).
   */
  async applyScheduleTemplate(
    identity: RequestIdentity,
    projectId: string,
    templateKey: ScheduleTemplateKey,
  ): Promise<ApplyScheduleTemplateResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const phases = scheduleTemplatePhases(templateKey);
    if (!phases) throw new BadRequestException(`Unknown schedule template '${templateKey}'`);

    // Don't silently duplicate: seeding is only for a project that has no phases yet.
    const existing = await this.repo.countWorkPackages(prisma, identity.activeOrganizationId, projectId);
    if (existing > 0) {
      throw new ConflictException(
        'This project already has work packages. Applying a schedule template is only available on a project with none.',
      );
    }

    const created = await prisma.$transaction(async (tx) =>
      Promise.all(
        phases.map((phase, index) =>
          this.repo.createWorkPackage(tx as never, {
            organizationId: identity.activeOrganizationId,
            projectId,
            code: scheduleTemplateCode(index),
            name: phase.name,
            responsibleOwner: null,
            progressWeight: 0,
            durationDays: phase.durationDays,
            scheduleOnly: phase.scheduleOnly,
            createdBy: identity.userId,
          }),
        ),
      ),
    );

    return {
      projectId,
      templateKey,
      workPackages: created.map((wp) => ({
        id: wp.id,
        code: wp.code,
        name: wp.name,
        durationDays: wp.durationDays,
        scheduleOnly: wp.scheduleOnly,
      })),
    };
  }

  /**
   * Master Schedule P1-d (ADR-029): suggest each work package's progress weight from the BOQ value
   * assigned to it — so the wizard doesn't make the user guess weights. Read-only: it computes and
   * returns suggestions; the WP PATCH is what persists a chosen weight.
   *
   * Each package's suggested weight = (Σ value of its allocated BOQ leaves) ÷ (Σ value across ALL
   * packages), a 0..1 fraction. A `scheduleOnly` phase (no measurable scope) or a package with no
   * priced/assigned value suggests 0. When nothing anywhere carries a value (all-unpriced / empty),
   * every suggestion is 0 rather than a divide-by-zero. Reuses the same `findLeafValues` read the
   * roll-up weights by, so a suggestion always agrees with the BOQ's own arithmetic.
   */
  async suggestWeights(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<SuggestWeightsResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const packages = await this.repo.findWorkPackages(prisma, identity.activeOrganizationId, projectId);
    const allocatedLeafIds = packages.flatMap((wp) => wp.boqLinks.map((b) => b.boqNodeId));
    const leafValues = await this.repo.findLeafValues(prisma, projectId, allocatedLeafIds);
    const valueByNode = new Map<string, Decimal>(
      leafValues.map((v) => [v.id, new Decimal(v.totalAmount?.toString() ?? '0')] as const),
    );

    // Each package's assigned value; a scheduleOnly phase has no measurable scope so it contributes 0
    // and never appears in the denominator.
    const valueByPackage = new Map<string, Decimal>();
    let totalValue = ZERO;
    for (const wp of packages) {
      const value = wp.scheduleOnly
        ? ZERO
        : wp.boqLinks.reduce(
            (sum, b) => sum.plus(valueByNode.get(b.boqNodeId) ?? ZERO),
            ZERO,
          );
      valueByPackage.set(wp.id, value);
      totalValue = totalValue.plus(value);
    }

    const totalPositive = totalValue.greaterThan(ZERO);
    return {
      projectId,
      weights: packages.map((wp) => {
        const value = valueByPackage.get(wp.id) ?? ZERO;
        // No total value anywhere (all-unpriced / empty) ⇒ every suggestion is 0, never ÷0.
        const suggestedWeight = totalPositive ? value.div(totalValue).toNumber() : 0;
        return { workPackageId: wp.id, suggestedWeight };
      }),
    };
  }

  /**
   * Master Schedule P1-a (ADR-029): partial update of a work package + its schedule window (the WP
   * IS the master-schedule phase row). Project-scoped like every other WP mutation. Enforces the new
   * schedule invariants: `plannedEnd ≥ plannedStart` and `durationDays ≥ 0` (reusing
   * `validateActivityDates`), and a `scheduleOnly` phase must own no BOQ scope (§8.5). % complete and
   * actual dates are DERIVED on read — never accepted here.
   */
  async updateWorkPackage(identity: RequestIdentity, workPackageId: string, dto: UpdateWorkPackageDto) {
    const prisma = this.tenancy.getClient();
    const wp = await this.repo.findWorkPackageForUpdate(prisma, identity.activeOrganizationId, workPackageId);
    if (!wp) throw new NotFoundException(`Work package ${workPackageId} not found`);
    await this.projectAccess.assertMember(identity, wp.projectId);

    // Validate the effective (post-update) schedule window. Only-one-side edits are checked against
    // the value that would remain — but the update DTO carries no read of the stored dates, so when
    // only one bound is supplied we validate the pair only if both are present in this request.
    this.validateActivityDates(
      dto.plannedStart ?? undefined,
      dto.plannedEnd ?? undefined,
      dto.durationDays ?? undefined,
    );

    // §8.5: a non-measurable (schedule-only) phase is tracked by dates only and must carry no BOQ
    // scope, so its derived % stays honestly null rather than a silent 0.
    if (dto.scheduleOnly === true && wp._count.boqLinks > 0) {
      throw new BadRequestException(
        'A schedule-only phase cannot have BOQ scope. Remove its BOQ allocations first, or leave it measurable.',
      );
    }

    return this.repo.updateWorkPackage(prisma, workPackageId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.responsibleOwner !== undefined ? { responsibleOwner: dto.responsibleOwner } : {}),
      ...(dto.progressWeight !== undefined ? { progressWeight: new Decimal(dto.progressWeight) } : {}),
      ...(dto.plannedStart !== undefined
        ? { plannedStart: dto.plannedStart ? new Date(dto.plannedStart) : null }
        : {}),
      ...(dto.plannedEnd !== undefined
        ? { plannedEnd: dto.plannedEnd ? new Date(dto.plannedEnd) : null }
        : {}),
      ...(dto.durationDays !== undefined ? { durationDays: dto.durationDays } : {}),
      ...(dto.forecastEnd !== undefined
        ? { forecastEnd: dto.forecastEnd ? new Date(dto.forecastEnd) : null }
        : {}),
      ...(dto.scheduleOnly !== undefined ? { scheduleOnly: dto.scheduleOnly } : {}),
    });
  }

  /**
   * Project physical %: each package's progress is the **value-weighted** mean of its allocated BOQ
   * leaves' verified % — Σ(leaf value × leaf %) ÷ Σ(leaf value) (`weightedPackagePercent`, the
   * 2026-09-05 Option-A change; falls back to a plain average only when nothing in the package is
   * priced). Packages roll up to the project by their `progressWeight`. Reports weightsTotal +
   * weightsComplete so an incomplete plan (weights ≠ 100%) is visible.
   *
   * Master Schedule P1-a (ADR-029): each package line also carries its schedule window (planned
   * dates / duration / forecast) and `percentComplete` — the master-schedule read model. A
   * `scheduleOnly` phase (no BOQ scope, master-schedule §8.5) has no derivable %: its
   * `percentComplete` is null and it is excluded from both the weighting numerator and denominator,
   * tracked by dates alone rather than reported as a silent 0.
   *
   * Master Schedule P1-b (ADR-029): each line also carries DERIVED (never stored) schedule reads —
   * `actualStart`/`actualFinish` from the package's APPROVED-DPR measurement dates, and a per-phase
   * `scheduleStatus` from the planned window vs progress as-of `asOf` (default now; threaded like
   * `getScheduleVariance` so the status is testable with a fixed date). See `deriveActualDates` and
   * `derivePhaseScheduleStatus`.
   */
  async getRollup(identity: RequestIdentity, projectId: string, asOf?: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const at = asOf ? new Date(asOf) : new Date();

    const packages = await this.repo.findWorkPackages(prisma, identity.activeOrganizationId, projectId);
    const progressLines = await this.getProjectProgress(identity, projectId);
    const pctByNode = new Map<string, number>();
    for (const l of progressLines) pctByNode.set(l.boqNodeId, l.percentComplete ?? 0);

    // Every allocated leaf, not only the measured ones: a leaf with no progress yet still carries
    // value, and leaving it out would make a package look complete as soon as its first item was.
    const allocatedLeafIds = packages.flatMap((wp) => wp.boqLinks.map((b) => b.boqNodeId));
    const leafValues = await this.repo.findLeafValues(prisma, projectId, allocatedLeafIds);
    // ADR-029 CONST-BOQ-028 / spec P-1: a CONTINGENCY leaf is a held reserve, not physical work,
    // so it carries zero progress weight — a project with a large contingency line must show the
    // same physical % as one without it. Dropping it from the value map lets `weightedPackagePercent`
    // treat it as an absent (zero-value) leaf, and a package that is *only* contingency falls through
    // to the existing unpriced-package plain-average fallback rather than reading 0%. SEPARATE_CHARGE
    // and ABSORBED leaves are `nodeRole = WORK`, so they keep their value and roll up normally (P-2).
    const valueByNode = progressValueByLeaf(leafValues);

    // P1-b: one batched read of the APPROVED-DPR report dates across every allocated leaf, folded to
    // per-node min/max. Each package then reads its own actual window from its leaves.
    const reportDates = await this.repo.approvedReportDatesForLeaves(
      prisma,
      identity.activeOrganizationId,
      allocatedLeafIds,
    );
    const rangeByNode = new Map<string, { min: Date; max: Date }>();
    for (const { boqNodeId, reportDate } of reportDates) {
      const cur = rangeByNode.get(boqNodeId);
      if (!cur) {
        rangeByNode.set(boqNodeId, { min: reportDate, max: reportDate });
      } else {
        if (reportDate.getTime() < cur.min.getTime()) cur.min = reportDate;
        if (reportDate.getTime() > cur.max.getTime()) cur.max = reportDate;
      }
    }

    let weightsTotal = ZERO;
    let weighted = ZERO;
    const packageLines = packages.map((wp) => {
      const leaves = wp.boqLinks.map((b) => b.boqNodeId);
      const { actualStart, actualFinishCandidate } = deriveActualDates(leaves, rangeByNode);
      // A schedule-only phase has no measurable scope: no derived %, and it takes no part in the
      // project weighting (master-schedule §8.5). Its own progressWeight should be 0, but exclude it
      // from weightsTotal too so it never drags weightsComplete off 100%.
      if (wp.scheduleOnly) {
        return {
          id: wp.id,
          code: wp.code,
          name: wp.name,
          responsibleOwner: wp.responsibleOwner,
          weight: new Decimal(wp.progressWeight.toString()).toString(),
          percentComplete: null,
          leafCount: leaves.length,
          plannedStart: isoOrNull(wp.plannedStart),
          plannedEnd: isoOrNull(wp.plannedEnd),
          durationDays: wp.durationDays,
          forecastEnd: isoOrNull(wp.forecastEnd),
          scheduleOnly: true,
          // A schedule-only phase has no measurable scope, so it never accrues APPROVED-DPR dates:
          // actualStart/Finish stay null and its status is derived from the dates alone.
          actualStart: null,
          actualFinish: null,
          scheduleStatus: deriveScheduleOnlyStatus(wp.plannedStart, wp.plannedEnd, at),
        };
      }
      // Value-weighted, not a plain average — see `progress-rollup.ts` for why. The rounded figure
      // comes from the same helper milestone readiness reads (ProgrammeService), so they agree.
      const pct = weightedPackagePercent(leaves, pctByNode, valueByNode);
      const percentComplete = packagePercentComplete(leaves, pctByNode, valueByNode);
      const weight = new Decimal(wp.progressWeight.toString());
      weightsTotal = weightsTotal.plus(weight);
      weighted = weighted.plus(weight.mul(pct));
      return {
        id: wp.id,
        code: wp.code,
        name: wp.name,
        responsibleOwner: wp.responsibleOwner,
        weight: weight.toString(),
        percentComplete,
        leafCount: leaves.length,
        plannedStart: isoOrNull(wp.plannedStart),
        plannedEnd: isoOrNull(wp.plannedEnd),
        durationDays: wp.durationDays,
        forecastEnd: isoOrNull(wp.forecastEnd),
        scheduleOnly: false,
        actualStart: isoOrNull(actualStart),
        // Approximation of "crossed 100%": the latest APPROVED-DPR date is a finish only once the
        // package is fully verified. Exact-crossing replay (the day the last unit landed) is deferred.
        actualFinish: percentComplete === 100 ? isoOrNull(actualFinishCandidate) : null,
        scheduleStatus: derivePhaseScheduleStatus(wp.plannedStart, wp.plannedEnd, percentComplete, at),
      };
    });

    return {
      projectId,
      physicalPercent: Math.round(weighted.toNumber() * 100) / 100,
      weightsTotal: weightsTotal.toString(),
      weightsComplete: weightsTotal.minus(1).abs().lessThan(0.0001),
      packages: packageLines,
    };
  }

  /**
   * Physical-vs-financial early warning (ADR-021/023): weighted physical % (roll-up) against how
   * much of the **baselined cost budget** has been consumed. A large positive gap (cost ahead of
   * progress) says "investigate"; a large negative gap means progress is ahead of spend. The cost
   * read crosses into accounting — the allowed direction.
   *
   * The denominator is the budget, and is `null` when no budget is baselined. It used to be
   * `forecastCost` (= actual + committed + accrued), which is not a forecast: with no open
   * purchase orders it equals actual, so this ratio read **100% cost consumed** on any project
   * that happened to have nothing on order — and then reported COST_AHEAD against real progress.
   * A project that has set no budget has not consumed 0% of it, so INSUFFICIENT_DATA is the
   * honest answer rather than a ratio against a number nobody agreed.
   */
  async getPhysicalFinancialSignal(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<PhysicalFinancialSignalResponse> {
    const signal = await this.computePhysicalFinancialSignal(identity, projectId);
    // Money-blind callers (PM / Site Engineer, per the owner's financial-visibility decision) see
    // neither the cost amounts nor anything derived from them (owner decision 2026-09-29): the cost
    // consumed %, the divergence and the status would each disclose the budget ratio. Only the
    // physical % — not money — stays. `status: 'HIDDEN'` is distinct from INSUFFICIENT_DATA ("no
    // budget yet"), which would be a false statement about the project.
    const { canViewCost } = resolveBoqVisibility(identity);
    if (canViewCost) return signal;
    return {
      ...signal,
      actualCost: null,
      budgetTotal: null,
      moneyVisible: false,
      costConsumedPercent: null,
      divergence: null,
      status: 'HIDDEN',
    };
  }

  /**
   * The unredacted physical-vs-financial signal. Internal only: the snapshot capture freezes the
   * true cost-consumed % whoever captures it; every response goes through the redacting wrapper.
   */
  private async computePhysicalFinancialSignal(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<PhysicalFinancialSignalResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const rollup = await this.getRollup(identity, projectId);
    const fp = await this.financialPosition.getForProject(identity, projectId);

    const budgetTotal = fp.budgetTotal === null ? null : new Decimal(fp.budgetTotal);
    const actualCost = new Decimal(fp.actualCost);
    const costConsumedPercent =
      budgetTotal !== null && budgetTotal.greaterThan(ZERO)
        ? Math.round(actualCost.div(budgetTotal).mul(100).toNumber() * 100) / 100
        : null;

    const physicalPercent = rollup.physicalPercent;
    const { divergence, status } = classifyDivergence(
      physicalPercent,
      costConsumedPercent,
      'PROGRESS_AHEAD',
      'COST_AHEAD',
    );

    return {
      projectId,
      physicalPercent,
      actualCost: fp.actualCost,
      budgetTotal: fp.budgetTotal,
      moneyVisible: true,
      costConsumedPercent,
      divergence,
      status,
      weightsComplete: rollup.weightsComplete,
    };
  }

  /**
   * Collection-vs-progress early warning (ADR-021/023): how much of the contract has been COLLECTED
   * (received ÷ contract value) against how much has been physically BUILT (weighted roll-up). A large
   * positive gap (cash ahead of work) is the client financing ACCO — healthy cashflow, but flags
   * exposure if the advance is spent before the work is delivered; a large negative gap (work ahead of
   * cash) is ACCO financing the client. The revenue read crosses into accounting — the allowed direction.
   */
  async getCollectionProgressSignal(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<CollectionProgressSignalResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const rollup = await this.getRollup(identity, projectId);
    const fp = await this.financialPosition.getForProject(identity, projectId);

    const contractValue = fp.contractValue === null ? null : new Decimal(fp.contractValue);
    const received = fp.receivedRevenue === null ? null : new Decimal(fp.receivedRevenue);
    const collectedPercent =
      contractValue !== null && received !== null && contractValue.greaterThan(ZERO)
        ? Math.round(received.div(contractValue).mul(100).toNumber() * 100) / 100
        : null;

    const physicalPercent = rollup.physicalPercent;
    const { divergence, status } = classifyDivergence(
      collectedPercent,
      physicalPercent,
      'CASH_AHEAD',
      'WORK_AHEAD',
    );

    // Contract value and client revenue are the commercial (margin) tier. A money-blind caller sees
    // neither them nor the collected % (received ÷ contract), nor the divergence / status computed
    // from it (owner decision 2026-09-29) — only the physical %, which is not money.
    const { canViewMargin } = resolveBoqVisibility(identity);
    if (!canViewMargin) {
      return {
        projectId,
        physicalPercent,
        contractValue: null,
        receivedRevenue: null,
        moneyVisible: false,
        collectedPercent: null,
        divergence: null,
        status: 'HIDDEN',
        weightsComplete: rollup.weightsComplete,
      };
    }

    return {
      projectId,
      physicalPercent,
      contractValue: fp.contractValue,
      receivedRevenue: fp.receivedRevenue,
      moneyVisible: true,
      collectedPercent,
      divergence,
      status,
      weightsComplete: rollup.weightsComplete,
    };
  }

  // ── ADR-021 CONST-PROG-011: planned baseline + schedule variance ──────────────

  /**
   * The governing (APPROVED) programme baseline's frozen curve for a project, or null when none has
   * been approved yet. Master Schedule P3 (ADR-029): read directly through the baseline repo so the
   * variance engine can source the frozen plan without reaching for Prisma.
   */
  private async findGoverningBaseline(orgId: string, projectId: string) {
    const prisma = this.tenancy.getClient();
    return this.baselineRepo.findApproved(prisma as never, orgId, projectId);
  }

  /**
   * Master Schedule P3 (ADR-029): the single planned-curve source of truth for the variance engine.
   * The plan is resolved in one place, three-way:
   *  - a governing APPROVED `ProgrammeBaseline` exists → its frozen snapshot (`source:'baseline'`, `version`);
   *  - else the live `ProgressTarget` curve, if any (`source:'targets'`, `version:null`);
   *  - else the provisional linear ramp Project.startDate → expectedEndDate (`source:'provisional'`).
   *
   * Points are returned in the interpolatable `{targetDate, cumulativePercent}` shape so
   * `plannedPercentAt` reads all three sources uniformly. The provisional ramp is expressed as its two
   * endpoints (0% at start, 100% at end); it is empty when the project has no usable dates — the read
   * then reports INSUFFICIENT_DATA, exactly as before.
   */
  private async resolvePlannedCurve(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<{
    points: { targetDate: Date; cumulativePercent: number }[];
    source: ProgressCurveSource;
    version: number | null;
  }> {
    const orgId = identity.activeOrganizationId;
    const prisma = this.tenancy.getClient();

    const baseline = await this.findGoverningBaseline(orgId, projectId);
    if (baseline) {
      return {
        points: baseline.points.map((p) => ({
          targetDate: p.targetDate,
          cumulativePercent: Number(p.cumulativePercent),
        })),
        source: 'baseline',
        version: baseline.version,
      };
    }

    const targets = await this.repo.findTargets(prisma, projectId);
    if (targets.length > 0) {
      return {
        points: targets.map((t) => ({
          targetDate: t.targetDate,
          cumulativePercent: Number(t.cumulativePercent),
        })),
        source: 'targets',
        version: null,
      };
    }

    const dates = await this.repo.findProjectDates(prisma, orgId, projectId);
    const startDate = dates?.startDate ?? null;
    const expectedEndDate = dates?.expectedEndDate ?? null;
    // The provisional ramp is the two endpoints; empty when the project has no usable dates (missing,
    // or end ≤ start) — mirrors computeProvisionalBaseline returning [] so the read stays INSUFFICIENT_DATA.
    const points =
      startDate && expectedEndDate && expectedEndDate.getTime() > startDate.getTime()
        ? [
            { targetDate: startDate, cumulativePercent: 0 },
            { targetDate: expectedEndDate, cumulativePercent: 100 },
          ]
        : [];
    return { points, source: 'provisional', version: null };
  }

  /**
   * Replaces the project's live planned-progress curve (ACCO's monthly milestones). Validates
   * that the cumulative percentages are in [0, 100], the dates are unique, and the curve is
   * non-decreasing over time (cumulative progress cannot go backwards).
   *
   * Master Schedule P3 (ADR-029): this edits the *working* curve, which the PM stages freely. It is
   * NOT the governing plan — once a baseline is approved the frozen `ProgrammeBaseline` drives
   * variance (see `resolvePlannedCurve`), and the working curve becomes governing only when it is
   * published via approve/re-baseline (a governed version, senior + Variation). Editing here never
   * moves the approved baseline; it just stages the next one.
   */
  async setTargets(identity: RequestIdentity, projectId: string, targets: ProgressTargetInput[]) {
    await this.projectAccess.assertMember(identity, projectId);

    const sorted = [...targets].sort(
      (a, b) => new Date(a.targetDate).getTime() - new Date(b.targetDate).getTime(),
    );
    let prevPct = -1;
    let prevDate = Number.NEGATIVE_INFINITY;
    for (const t of sorted) {
      const d = new Date(t.targetDate).getTime();
      if (Number.isNaN(d)) throw new BadRequestException(`Invalid target date '${t.targetDate}'`);
      if (t.cumulativePercent < 0 || t.cumulativePercent > 100) {
        throw new BadRequestException('cumulativePercent must be between 0 and 100');
      }
      if (d === prevDate) throw new BadRequestException('Duplicate target date');
      if (t.cumulativePercent < prevPct) {
        throw new BadRequestException('Cumulative percent must be non-decreasing over time');
      }
      prevPct = t.cumulativePercent;
      prevDate = d;
    }

    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    await prisma.$transaction(async (tx) => {
      await this.repo.deleteTargetsForProject(tx as never, projectId);
      if (sorted.length) {
        await this.repo.createTargets(
          tx as never,
          sorted.map((t) => ({
            organizationId: orgId,
            projectId,
            targetDate: new Date(t.targetDate),
            cumulativePercent: new Decimal(t.cumulativePercent),
            createdBy: identity.userId,
          })),
        );
      }
    });
    return this.getTargets(identity, projectId);
  }

  async getTargets(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const rows = await this.repo.findTargets(prisma, projectId);
    return rows.map((r) => ({
      targetDate: r.targetDate.toISOString().slice(0, 10),
      cumulativePercent: Number(r.cumulativePercent),
    }));
  }

  /**
   * Planned-vs-verified schedule variance: the planned cumulative % due today (interpolated from the
   * planned curve) against the verified physical % (the weighted roll-up). A large negative gap means
   * the project is behind schedule; positive means ahead. Null when no planned curve resolves.
   *
   * Master Schedule P3 (ADR-029): the planned side comes from `resolvePlannedCurve` — the governing
   * frozen baseline when one is approved, else the live targets, else the provisional ramp.
   */
  async getScheduleVariance(identity: RequestIdentity, projectId: string, asOf?: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const planned = await this.resolvePlannedCurve(identity, projectId);
    const at = asOf ? new Date(asOf) : new Date();

    const plannedPercent = plannedPercentAt(planned.points, at);
    const rollup = await this.getRollup(identity, projectId);
    const physicalPercent = rollup.physicalPercent;

    const { divergence, status } = classifyDivergence(
      physicalPercent,
      plannedPercent,
      'AHEAD_OF_SCHEDULE',
      'BEHIND_SCHEDULE',
    );

    return {
      projectId,
      asOf: at.toISOString().slice(0, 10),
      plannedPercent,
      physicalPercent,
      variance: divergence,
      status,
      weightsComplete: rollup.weightsComplete,
    };
  }

  // ── Round-2 Progress-over-time (BE-1): immutable snapshots + curve + comparison ──

  /**
   * Overall verified % (verified-to-date ÷ measurable, across all leaves) — distinct from the
   * weighted physical roll-up. Reuses getProjectProgress (verified-per-leaf from APPROVED DPRs) so
   * no verification logic is reimplemented here.
   */
  private async computeVerifiedPercent(identity: RequestIdentity, projectId: string): Promise<number> {
    const lines = await this.getProjectProgress(identity, projectId);
    let measurable = ZERO;
    let verified = ZERO;
    for (const l of lines) {
      measurable = measurable.plus(new Decimal(l.measurableQuantity));
      verified = verified.plus(new Decimal(l.verifiedToDate));
    }
    if (!measurable.greaterThan(ZERO)) return 0;
    return Math.min(100, Math.round(verified.div(measurable).mul(100).toNumber() * 100) / 100);
  }

  /**
   * Capture an immutable ProgressSnapshot (source=MANUAL) freezing what ADR-021 already computes:
   * the weighted physical roll-up (getRollup), overall verified-to-date, and the cost-consumed % from
   * the physical-vs-financial signal. `periodEndDate` defaults to today but is otherwise the supplied
   * "as of" date — never new Date() for the stored date (the accounting-date rule). Rejects a second
   * capture for the same period (409) to honour @@unique(projectId, periodEndDate).
   */
  async captureSnapshot(
    identity: RequestIdentity,
    projectId: string,
    periodEndDate?: string,
  ): Promise<ProgressSnapshotResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    // The stored period-end is the supplied "as of" (accounting-date rule). Default = today, but the
    // captured *reading* is the live computation regardless; only the label date defaults to today.
    const asOf = periodEndDate ? new Date(periodEndDate) : new Date();
    if (Number.isNaN(asOf.getTime())) {
      throw new BadRequestException(`Invalid periodEndDate '${periodEndDate}'`);
    }
    // Normalise to a calendar date (the column is @db.Date); avoids a same-day duplicate slipping past
    // the unique index on a timestamp difference.
    const periodDate = new Date(`${isoDate(asOf)}T00:00:00.000Z`);

    const existing = await this.repo.findSnapshotForPeriod(prisma, projectId, periodDate);
    if (existing) {
      throw new ConflictException(
        `A progress snapshot already exists for ${isoDate(periodDate)}. Snapshots are immutable per period.`,
      );
    }

    // The unredacted reading: a snapshot is a frozen fact about the project, not about who captured
    // it — a money-blind capturer must not freeze a null cost % into history.
    const signal = await this.computePhysicalFinancialSignal(identity, projectId);
    const verifiedPercent = await this.computeVerifiedPercent(identity, projectId);

    const row = await this.repo.createSnapshot(prisma, {
      organizationId: identity.activeOrganizationId,
      projectId,
      periodEndDate: periodDate,
      accountingPeriodId: null,
      physicalPercent: new Decimal(signal.physicalPercent),
      verifiedPercent: new Decimal(verifiedPercent),
      costConsumedPercent:
        signal.costConsumedPercent === null ? null : new Decimal(signal.costConsumedPercent),
      source: 'MANUAL',
      capturedById: identity.userId,
    });
    const snapshot = toSnapshotResponse(row);
    // The stored row keeps the true figure; the response hides it from a cost-blind capturer.
    return resolveBoqVisibility(identity).canViewCost ? snapshot : { ...snapshot, costConsumedPercent: null };
  }

  private async loadActualSeries(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<{ snapshots: ProgressSnapshotResponse[]; actual: ProgressActualPoint[] }> {
    const prisma = this.tenancy.getClient();
    const rows = await this.repo.findSnapshotsForProject(prisma, identity.activeOrganizationId, projectId);
    const snapshots = rows.map(toSnapshotResponse);
    // The frozen cost-consumed % is the same budget ratio the live signal hides from a cost-blind
    // caller (owner decision 2026-09-29), so the curve withholds it too.
    const { canViewCost } = resolveBoqVisibility(identity);
    const actual: ProgressActualPoint[] = snapshots.map((s) => ({
      periodEndDate: s.periodEndDate,
      physicalPercent: s.physicalPercent,
      verifiedPercent: s.verifiedPercent,
      costPercent: canViewCost ? s.costConsumedPercent : null,
    }));
    return { snapshots, actual };
  }

  /**
   * The planned-vs-actual S-curve. Actual = the snapshot series ordered by period. The planned line
   * comes from `resolvePlannedCurve` (Master Schedule P3, ADR-029): the governing frozen baseline when
   * one is approved, else the live targets, else the provisional Option-C ramp. Status/variance compare
   * the latest actual physical % to the planned % at that date. All interpolation is the pure
   * progress-curve math.
   *
   * The baseline output array is source-shaped, preserving the pre-P3 contract: an entered plan
   * (baseline/targets) is returned as its own points; the provisional ramp is sampled at the actual
   * period dates (so the drawn planned line lines up with the actual line).
   */
  async getCurve(identity: RequestIdentity, projectId: string): Promise<ProgressCurveResponse> {
    await this.projectAccess.assertMember(identity, projectId);

    const { actual } = await this.loadActualSeries(identity, projectId);
    const planned = await this.resolvePlannedCurve(identity, projectId);
    const isProvisional = planned.source === 'provisional';

    // An entered plan (baseline/targets) is returned as its own points; the provisional ramp is
    // sampled at the actual period dates (empty when the ramp has no usable dates → INSUFFICIENT_DATA).
    const baseline: ProgressCurvePoint[] = isProvisional
      ? planned.points.length === 0
        ? []
        : actual.map((a) => {
            const at = new Date(a.periodEndDate);
            return {
              periodEndDate: isoDate(at),
              plannedPercent: plannedPercentAt(planned.points, at) ?? 0,
            };
          })
      : planned.points.map((p) => ({
          periodEndDate: isoDate(p.targetDate),
          plannedPercent: p.cumulativePercent,
        }));

    // Variance = latest actual physical − planned at that date, interpolated from the resolved curve.
    let scheduleVariancePercent: number | null = null;
    let status: ProgressCurveResponse['status'] = 'INSUFFICIENT_DATA';
    if (actual.length > 0 && planned.points.length > 0) {
      const latest = actual[actual.length - 1];
      const plannedAtLatest = plannedPercentAt(planned.points, new Date(latest.periodEndDate));
      if (plannedAtLatest !== null) {
        scheduleVariancePercent = Math.round((latest.physicalPercent - plannedAtLatest) * 100) / 100;
        status = scheduleStatusFor(scheduleVariancePercent);
      }
    }

    return {
      projectId,
      baseline,
      actual,
      scheduleVariancePercent,
      status,
      baselineProvisional: isProvisional,
      baselineSource: planned.source,
      baselineVersion: planned.version,
    };
  }

  /**
   * Overall (project-level) period-over-period comparison from the two most-recent snapshots — the
   * physical and verified % of the current vs the previous period, and their deltas. Nulls when fewer
   * than two snapshots exist. BE-2 SEAM: per-BOQ-leaf comparison is deferred — it needs per-leaf
   * snapshot lines (or a verified-as-of derivation) that BE-1 deliberately does not store.
   */
  async getPeriodComparison(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProgressPeriodComparisonResponse> {
    const { snapshots } = await this.loadActualSeries(identity, projectId);
    if (snapshots.length < 2) {
      return {
        projectId,
        previousPeriodEndDate: snapshots.length === 1 ? snapshots[0].periodEndDate : null,
        currentPeriodEndDate: null,
        physical: null,
        verified: null,
      };
    }
    const previous = snapshots[snapshots.length - 2];
    const current = snapshots[snapshots.length - 1];
    const delta = (a: number, b: number) => Math.round((b - a) * 100) / 100;
    return {
      projectId,
      previousPeriodEndDate: previous.periodEndDate,
      currentPeriodEndDate: current.periodEndDate,
      physical: {
        previous: previous.physicalPercent,
        current: current.physicalPercent,
        delta: delta(previous.physicalPercent, current.physicalPercent),
      },
      verified: {
        previous: previous.verifiedPercent,
        current: current.verifiedPercent,
        delta: delta(previous.verifiedPercent, current.verifiedPercent),
      },
    };
  }

  // ── ADR-021 CONST-PROG-005: programme activities (time layer under a work package) ──

  async createActivity(identity: RequestIdentity, workPackageId: string, dto: CreateActivityDto) {
    const prisma = this.tenancy.getClient();
    const wp = await this.repo.findWorkPackageById(prisma, identity.activeOrganizationId, workPackageId);
    if (!wp) throw new NotFoundException(`Work package ${workPackageId} not found`);
    await this.projectAccess.assertMember(identity, wp.projectId);
    this.validateActivityDates(dto.plannedStart, dto.plannedEnd, dto.durationDays);
    return this.repo.createActivity(prisma, {
      organizationId: identity.activeOrganizationId,
      workPackageId,
      code: dto.code,
      name: dto.name,
      plannedStart: dto.plannedStart ? new Date(dto.plannedStart) : null,
      plannedEnd: dto.plannedEnd ? new Date(dto.plannedEnd) : null,
      durationDays: dto.durationDays ?? null,
      isMilestone: dto.isMilestone ?? false,
      sortOrder: dto.sortOrder ?? 0,
      createdBy: identity.userId,
    });
  }

  async listActivities(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findActivitiesForProject(this.tenancy.getClient(), identity.activeOrganizationId, projectId);
  }

  async updateActivity(identity: RequestIdentity, activityId: string, dto: UpdateActivityDto) {
    const prisma = this.tenancy.getClient();
    const activity = await this.repo.findActivityById(prisma, identity.activeOrganizationId, activityId);
    if (!activity) throw new NotFoundException(`Activity ${activityId} not found`);
    await this.projectAccess.assertMember(identity, activity.workPackage.projectId);

    // Validate the effective (post-update) dates.
    const start =
      dto.plannedStart !== undefined ? dto.plannedStart : activity.plannedStart?.toISOString();
    const end = dto.plannedEnd !== undefined ? dto.plannedEnd : activity.plannedEnd?.toISOString();
    this.validateActivityDates(start ?? undefined, end ?? undefined, dto.durationDays ?? undefined);

    return this.repo.updateActivity(prisma, activityId, {
      ...(dto.name !== undefined ? { name: dto.name } : {}),
      ...(dto.plannedStart !== undefined
        ? { plannedStart: dto.plannedStart ? new Date(dto.plannedStart) : null }
        : {}),
      ...(dto.plannedEnd !== undefined
        ? { plannedEnd: dto.plannedEnd ? new Date(dto.plannedEnd) : null }
        : {}),
      ...(dto.durationDays !== undefined ? { durationDays: dto.durationDays } : {}),
      ...(dto.isMilestone !== undefined ? { isMilestone: dto.isMilestone } : {}),
      ...(dto.sortOrder !== undefined ? { sortOrder: dto.sortOrder } : {}),
    });
  }

  async deleteActivity(identity: RequestIdentity, activityId: string) {
    const prisma = this.tenancy.getClient();
    const activity = await this.repo.findActivityById(prisma, identity.activeOrganizationId, activityId);
    if (!activity) throw new NotFoundException(`Activity ${activityId} not found`);
    await this.projectAccess.assertMember(identity, activity.workPackage.projectId);
    await this.repo.deleteActivity(prisma, activityId);
  }

  private validateActivityDates(start?: string | null, end?: string | null, durationDays?: number | null) {
    if (durationDays !== undefined && durationDays !== null && durationDays < 0) {
      throw new BadRequestException('durationDays must be >= 0');
    }
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      throw new BadRequestException('plannedEnd cannot be before plannedStart');
    }
  }
}

export interface CreateActivityDto {
  code: string;
  name: string;
  plannedStart?: string;
  plannedEnd?: string;
  durationDays?: number;
  isMilestone?: boolean;
  sortOrder?: number;
}

export interface UpdateActivityDto {
  name?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  durationDays?: number | null;
  isMilestone?: boolean;
  sortOrder?: number;
}

export interface ProgressTargetInput {
  targetDate: string;
  cumulativePercent: number;
}

/**
 * The planned cumulative % due at a date, interpolated from the target curve. Before the first
 * target it is 0 (nothing due yet — conservative, never falsely "behind"); after the last it is the
 * last cumulative %; between two targets it is a linear interpolation (the classic planned S-curve).
 */
function plannedPercentAt(
  targets: { targetDate: Date; cumulativePercent: unknown }[],
  at: Date,
): number | null {
  if (targets.length === 0) return null;
  const t = at.getTime();
  const first = targets[0];
  const last = targets[targets.length - 1];
  if (t < first.targetDate.getTime()) return 0;
  if (t >= last.targetDate.getTime()) return Number(last.cumulativePercent);
  for (let i = 0; i < targets.length - 1; i++) {
    const a = targets[i];
    const b = targets[i + 1];
    const ta = a.targetDate.getTime();
    const tb = b.targetDate.getTime();
    if (t >= ta && t < tb) {
      const pa = Number(a.cumulativePercent);
      const pb = Number(b.cumulativePercent);
      const frac = (t - ta) / (tb - ta);
      return Math.round((pa + (pb - pa) * frac) * 100) / 100;
    }
  }
  return Number(last.cumulativePercent);
}

/** A `@db.Date` column → ISO `YYYY-MM-DD`, or null. The date-only shape the read models use. */
function isoOrNull(date: Date | null | undefined): string | null {
  return date ? isoDate(date) : null;
}

/**
 * Master Schedule P1-b (ADR-029): a package's DERIVED actual window from its leaves' APPROVED-DPR
 * report dates. `actualStart` = the earliest such date across the package's leaves (null when the
 * package has no verified progress). `actualFinishCandidate` = the latest such date — only a *finish*
 * once the package reads 100% (that gate is applied by the caller); it is null when nothing is
 * measured.
 */
function deriveActualDates(
  leafIds: string[],
  rangeByNode: Map<string, { min: Date; max: Date }>,
): { actualStart: Date | null; actualFinishCandidate: Date | null } {
  let start: Date | null = null;
  let finish: Date | null = null;
  for (const id of leafIds) {
    const range = rangeByNode.get(id);
    if (!range) continue;
    if (start === null || range.min.getTime() < start.getTime()) start = range.min;
    if (finish === null || range.max.getTime() > finish.getTime()) finish = range.max;
  }
  return { actualStart: start, actualFinishCandidate: finish };
}

/**
 * The planned expected-to-date % for a phase at `asOf`: 0 at/before plannedStart, 100 at/after
 * plannedEnd, linear in between. Day-grained (the columns are `@db.Date`). Null when either bound is
 * missing — the phase then has no schedule baseline to judge against.
 */
function phaseExpectedPercentAt(
  plannedStart: Date | null | undefined,
  plannedEnd: Date | null | undefined,
  asOf: Date,
): number | null {
  if (!plannedStart || !plannedEnd) return null;
  const start = plannedStart.getTime();
  const end = plannedEnd.getTime();
  if (end <= start) return asOf.getTime() >= end ? 100 : 0;
  const t = asOf.getTime();
  if (t <= start) return 0;
  if (t >= end) return 100;
  return ((t - start) / (end - start)) * 100;
}

/**
 * Master Schedule P1-b (ADR-029): per-phase schedule health for a MEASURABLE package. Expected-to-date
 * % comes from the planned window vs `asOf`; the variance (actual − expected) maps through the same
 * `scheduleStatusFor` bands as the project S-curve. INSUFFICIENT_DATA when the planned window is
 * unset (mirrors `scheduleStatusFor(null)`).
 */
function derivePhaseScheduleStatus(
  plannedStart: Date | null | undefined,
  plannedEnd: Date | null | undefined,
  actualPercent: number,
  asOf: Date,
): ProgressScheduleStatus {
  const expected = phaseExpectedPercentAt(plannedStart, plannedEnd, asOf);
  if (expected === null) return scheduleStatusFor(null);
  return scheduleStatusFor(actualPercent - expected);
}

/**
 * Master Schedule P1-b (ADR-029): per-phase schedule health for a SCHEDULE-ONLY package, which has no
 * measurable % — so it is judged by dates alone (kept deliberately simple, §8.5):
 * finished by plannedEnd is not knowable without a % signal, so past plannedEnd it reads BEHIND (the
 * phase's window has lapsed and nothing marks it done); on or before plannedEnd it reads ON_TRACK;
 * INSUFFICIENT_DATA when the planned window is unset.
 */
function deriveScheduleOnlyStatus(
  plannedStart: Date | null | undefined,
  plannedEnd: Date | null | undefined,
  asOf: Date,
): ProgressScheduleStatus {
  if (!plannedStart || !plannedEnd) return 'INSUFFICIENT_DATA';
  return asOf.getTime() > plannedEnd.getTime() ? 'BEHIND' : 'ON_TRACK';
}

export interface CreateWorkPackageDto {
  code: string;
  name: string;
  responsibleOwner?: string;
  progressWeight?: number;
}

export interface SaveDeliveryPlanDto {
  packages: DeliveryPlanPackageInput[];
}

// Master Schedule P1-a (ADR-029): partial WP update incl. the schedule window. Dates are ISO
// strings (@db.Date). % complete + actual dates are derived on read, never accepted here.
export interface UpdateWorkPackageDto {
  name?: string;
  responsibleOwner?: string | null;
  progressWeight?: number;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  durationDays?: number | null;
  forecastEnd?: string | null;
  scheduleOnly?: boolean;
}

/** Maps a stored ProgressSnapshot row to its wire DTO (Decimals → numbers, Dates → ISO). */
function toSnapshotResponse(row: {
  id: string;
  projectId: string;
  periodEndDate: Date;
  accountingPeriodId: string | null;
  physicalPercent: unknown;
  verifiedPercent: unknown;
  costConsumedPercent: unknown;
  source: string;
  capturedAt: Date;
  capturedById: string;
}): ProgressSnapshotResponse {
  return {
    id: row.id,
    projectId: row.projectId,
    periodEndDate: isoDate(row.periodEndDate),
    accountingPeriodId: row.accountingPeriodId,
    physicalPercent: Number(row.physicalPercent),
    verifiedPercent: Number(row.verifiedPercent),
    costConsumedPercent: row.costConsumedPercent === null ? null : Number(row.costConsumedPercent),
    source: row.source as ProgressSnapshotResponse['source'],
    capturedAt: row.capturedAt.toISOString(),
    capturedById: row.capturedById,
  };
}
