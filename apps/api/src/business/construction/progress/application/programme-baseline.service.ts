import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { ProgrammeBaselineResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ProgrammeBaselineRepository } from '../infrastructure/programme-baseline.repository.js';

type BaselineWithPoints = {
  id: string;
  projectId: string;
  version: number;
  status: string;
  approvedBy: string;
  approvedAt: Date;
  variationOrderId: string | null;
  note: string | null;
  createdAt: Date;
  points: { targetDate: Date; cumulativePercent: Decimal }[];
};

export interface RebaselineInput {
  variationOrderId: string;
  note?: string;
}

/**
 * Master Schedule P3 (ADR-029) — the frozen, versioned programme baseline.
 *
 * The planned target curve is working material until it is *approved*: an approved baseline freezes
 * the curve the project is measured against, and moving it afterwards is not an edit but a
 * re-baseline — a new version that supersedes the last, never an overwrite (Q-1). This mirrors the
 * BOQ and cost-budget pattern deliberately: a plan that can be edited in place is worthless as a
 * control, because the first response to slipping is to move the target and the evidence it moved
 * vanishes with it.
 *
 * Governance follows Eng Ahmed's Q-4: the **initial** baseline (v1) is a PM act (manage:project);
 * **re-baselining** (v>=2) is senior (approve:project) and must cite a Variation — the justification
 * for moving the frozen plan. Exactly one APPROVED baseline exists per project at a time, enforced
 * both in the transaction here and by a partial unique index at the database.
 *
 * This pass owns only the freeze aggregate. The variance engine (getCurve / getScheduleVariance /
 * setTargets) is not anchored to the baseline yet — that is Pass 2.
 */
@Injectable()
export class ProgrammeBaselineService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: ProgrammeBaselineRepository,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  /**
   * Approve the INITIAL baseline (v1). Snapshots the live target curve into a frozen APPROVED
   * version. Refuses when the live curve is empty (there is nothing to freeze) or when an APPROVED
   * baseline already exists (moving the plan is a re-baseline, not a second initial approval).
   *
   * Gate: manage:project (PM) — Q-4.
   */
  async approve(identity: RequestIdentity, projectId: string): Promise<ProgrammeBaselineResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const existing = await this.repo.findApproved(prisma, orgId, projectId);
    if (existing) {
      throw new ConflictException(
        `Project already has an approved programme baseline (version ${existing.version}). Re-baseline to supersede it.`,
      );
    }

    const targets = await this.repo.findTargets(prisma, projectId);
    if (targets.length === 0) {
      throw new BadRequestException(
        'The planned target curve is empty — set the curve before approving a baseline.',
      );
    }

    const approvedAt = new Date();
    const created = await prisma.$transaction(async (tx) => {
      const baseline = await this.repo.createApproved(tx as never, {
        organizationId: orgId,
        projectId,
        version: 1,
        approvedBy: identity.userId,
        approvedAt,
        variationOrderId: null,
        note: null,
        points: targets.map((t) => ({
          targetDate: t.targetDate,
          cumulativePercent: new Decimal(t.cumulativePercent.toString()),
        })),
      });

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'BASELINE',
        resourceType: 'ProgrammeBaseline',
        resourceId: baseline.id,
        sourceCommand: 'programmeBaseline.approve',
        eventType: 'PROGRAMME_BASELINE_APPROVED',
        idempotencyKey: `programme-baseline-approve-${baseline.id}`,
        after: { projectId, version: 1, status: 'APPROVED', pointCount: targets.length },
      });

      return baseline;
    });

    return this.findByIdOrThrow(identity, created.id);
  }

  /**
   * Re-baseline (v>=2): supersede the current APPROVED baseline and freeze a fresh version from the
   * live target curve, in one transaction. Requires a Variation as the justification (Q-4) and
   * validates that Variation belongs to *this* project (via its contract) so a foreign VO cannot be
   * cited. Refuses when there is no APPROVED baseline to re-baseline, and when the curve is empty.
   *
   * Gate: approve:project (senior) — Q-4.
   */
  async rebaseline(
    identity: RequestIdentity,
    projectId: string,
    input: RebaselineInput,
  ): Promise<ProgrammeBaselineResponse> {
    await this.projectAccess.assertMember(identity, projectId);

    const variationOrderId = input.variationOrderId?.trim();
    if (!variationOrderId) {
      throw new BadRequestException('Re-baselining requires a variationOrderId.');
    }

    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    // The Variation must belong to this project (VO -> contract -> project). A foreign VO cannot
    // justify moving this project's plan.
    const vo = await this.repo.findVariationOrderProject(prisma, orgId, variationOrderId);
    if (!vo) throw new NotFoundException(`Variation order ${variationOrderId} not found`);
    if (vo.contract.projectId !== projectId) {
      throw new BadRequestException(
        `Variation order ${variationOrderId} does not belong to project ${projectId}.`,
      );
    }

    const current = await this.repo.findApproved(prisma, orgId, projectId);
    if (!current) {
      throw new ConflictException(
        'No approved programme baseline to re-baseline. Approve the initial baseline first.',
      );
    }

    const targets = await this.repo.findTargets(prisma, projectId);
    if (targets.length === 0) {
      throw new BadRequestException(
        'The planned target curve is empty — set the curve before re-baselining.',
      );
    }

    const nextVersion = (await this.repo.findLatestVersion(prisma, orgId, projectId)) ?? 0;
    const version = nextVersion + 1;
    const approvedAt = new Date();

    const created = await prisma.$transaction(async (tx) => {
      await this.repo.supersedeApproved(tx as never, orgId, projectId);
      const baseline = await this.repo.createApproved(tx as never, {
        organizationId: orgId,
        projectId,
        version,
        approvedBy: identity.userId,
        approvedAt,
        variationOrderId,
        note: input.note ?? null,
        points: targets.map((t) => ({
          targetDate: t.targetDate,
          cumulativePercent: new Decimal(t.cumulativePercent.toString()),
        })),
      });

      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'BASELINE',
        resourceType: 'ProgrammeBaseline',
        resourceId: baseline.id,
        sourceCommand: 'programmeBaseline.rebaseline',
        eventType: 'PROGRAMME_BASELINE_REBASELINED',
        idempotencyKey: `programme-baseline-rebaseline-${baseline.id}`,
        before: { supersededVersion: current.version },
        after: {
          projectId,
          version,
          status: 'APPROVED',
          variationOrderId,
          pointCount: targets.length,
        },
      });

      return baseline;
    });

    return this.findByIdOrThrow(identity, created.id);
  }

  /**
   * The governing (APPROVED) baseline for a project, or null when none has been approved yet.
   *
   * Gate: view:project.
   */
  async getGoverning(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProgrammeBaselineResponse | null> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const baseline = await this.repo.findApproved(prisma, identity.activeOrganizationId, projectId);
    return baseline ? this.toResponse(baseline) : null;
  }

  private async findByIdOrThrow(
    identity: RequestIdentity,
    id: string,
  ): Promise<ProgrammeBaselineResponse> {
    const prisma = this.tenancy.getClient();
    const baseline = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!baseline) throw new NotFoundException(`Programme baseline ${id} not found`);
    return this.toResponse(baseline);
  }

  private toResponse(baseline: BaselineWithPoints): ProgrammeBaselineResponse {
    return {
      id: baseline.id,
      projectId: baseline.projectId,
      version: baseline.version,
      status: baseline.status as ProgrammeBaselineResponse['status'],
      approvedBy: baseline.approvedBy,
      approvedAt: baseline.approvedAt.toISOString(),
      variationOrderId: baseline.variationOrderId,
      note: baseline.note,
      createdAt: baseline.createdAt.toISOString(),
      points: baseline.points.map((p) => ({
        targetDate: p.targetDate.toISOString().slice(0, 10),
        cumulativePercent: Number(p.cumulativePercent),
      })),
    };
  }
}
