import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { DprStatus, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProgressRepository } from '../infrastructure/progress.repository.js';
import { ProjectFinancialPositionService } from '../../../accounting/financial-position/application/project-financial-position.service.js';

const DIVERGENCE_THRESHOLD = 20; // percentage points before the signal flags a divergence (cf. ADR-023 CONST-COM-018)

const ZERO = new Decimal(0);

/**
 * Classifies a signed percentage-point gap against DIVERGENCE_THRESHOLD, shared by the two cockpit
 * signals (physical-vs-financial, collection-vs-progress). `diff` = primary − secondary (positive =
 * primary ahead); `null` primary → INSUFFICIENT_DATA. Same threshold cascade, different status labels.
 */
function classifyDivergence<P extends string, N extends string>(
  diff: number | null,
  positiveStatus: P,
  negativeStatus: N,
): { divergence: number | null; status: P | N | 'ALIGNED' | 'INSUFFICIENT_DATA' } {
  if (diff === null) return { divergence: null, status: 'INSUFFICIENT_DATA' };
  const status =
    diff > DIVERGENCE_THRESHOLD
      ? positiveStatus
      : diff < -DIVERGENCE_THRESHOLD
        ? negativeStatus
        : 'ALIGNED';
  return { divergence: Math.round(diff * 100) / 100, status };
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
    if (dpr.status !== DprStatus.DRAFT && dpr.status !== DprStatus.RETURNED) {
      throw new BadRequestException('Measurements can only be added to a DRAFT report.');
    }
    if (!(dto.quantity > 0)) throw new BadRequestException('Quantity must be greater than 0.');

    const node = await this.repo.findBoqNodeForProject(prisma, dpr.projectId, dto.boqNodeId);
    if (!node) throw new NotFoundException('BOQ node not found for this project.');
    if (!node.isLeaf) throw new BadRequestException('Measure against a BOQ leaf item, not a section.');

    return this.repo.addMeasurement(prisma, {
      organizationId: identity.activeOrganizationId,
      dprId,
      boqNodeId: dto.boqNodeId,
      quantity: dto.quantity,
      notes: dto.notes ?? null,
      createdBy: identity.userId,
    });
  }

  async attachEvidence(identity: RequestIdentity, dprId: string, platformFileId: string) {
    const prisma = this.tenancy.getClient();
    await this.requireDpr(identity, dprId);
    const file = await this.repo.findFileStatus(prisma, identity.activeOrganizationId, platformFileId);
    if (!file) throw new NotFoundException(`File ${platformFileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The evidence file must be fully uploaded (READY).');
    }
    return this.repo.createAttachment(prisma, {
      dprId,
      platformFileId,
      createdBy: identity.userId,
    });
  }

  async submit(identity: RequestIdentity, dprId: string) {
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== DprStatus.DRAFT && dpr.status !== DprStatus.RETURNED) {
      throw new BadRequestException(`Cannot submit a ${dpr.status} report.`);
    }
    return this.repo.updateDprStatus(this.tenancy.getClient(), dprId, {
      status: DprStatus.SUBMITTED,
      submittedBy: identity.userId,
      submittedAt: new Date(),
    });
  }

  /** Approve → measurements become verified. Enforces the cumulative ≤ BOQ-scope invariant first. */
  async approve(identity: RequestIdentity, dprId: string) {
    const prisma = this.tenancy.getClient();
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== DprStatus.SUBMITTED) {
      throw new BadRequestException(`Only a SUBMITTED report can be approved (is ${dpr.status}).`);
    }

    const byNode = new Map<string, Decimal>();
    for (const m of dpr.measurements) {
      byNode.set(m.boqNodeId, (byNode.get(m.boqNodeId) ?? ZERO).plus(new Decimal(m.quantity.toString())));
    }
    for (const [nodeId, thisReport] of byNode) {
      const node = await this.repo.findBoqNodeForProject(prisma, dpr.projectId, nodeId);
      const scope = new Decimal(node?.quantity?.toString() ?? '0');
      const prior = await this.repo.sumVerifiedForNode(prisma, identity.activeOrganizationId, nodeId, dprId);
      const priorQty = new Decimal(prior._sum.quantity?.toString() ?? '0');
      if (priorQty.plus(thisReport).greaterThan(scope)) {
        throw new BadRequestException(
          `Approving would exceed the BOQ scope for a line ` +
            `(${priorQty.plus(thisReport).toString()} > ${scope.toString()}). ` +
            'Route the excess through an unplanned-requirement classification.',
        );
      }
    }

    return this.repo.updateDprStatus(prisma, dprId, {
      status: DprStatus.APPROVED,
      approvedBy: identity.userId,
      approvedAt: new Date(),
    });
  }

  async returnForRevision(identity: RequestIdentity, dprId: string, reason: string) {
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== DprStatus.SUBMITTED) {
      throw new BadRequestException('Only a SUBMITTED report can be returned.');
    }
    return this.repo.updateDprStatus(this.tenancy.getClient(), dprId, {
      status: DprStatus.RETURNED,
      returnReason: reason,
    });
  }

  async listDprs(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findDprsByProject(this.tenancy.getClient(), identity.activeOrganizationId, projectId);
  }

  getDpr(identity: RequestIdentity, dprId: string) {
    return this.requireDpr(identity, dprId);
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
      percentComplete: e.quantity.greaterThan(ZERO)
        ? Math.min(100, Math.round(e.verified.div(e.quantity).mul(100).toNumber()))
        : null,
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
      throw new BadRequestException('This BOQ item is already allocated to another work package.');
    }

    return this.repo.allocateBoqNode(prisma, workPackageId, boqNodeId);
  }

  async listWorkPackages(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findWorkPackages(this.tenancy.getClient(), identity.activeOrganizationId, projectId);
  }

  /**
   * Project physical %: each package's progress is the simple mean of its allocated BOQ leaves'
   * verified % (not money-weighted, CONST-PROG-007), rolled up by the package `progressWeight`.
   * Reports weightsTotal + weightsComplete so an incomplete plan (weights ≠ 100%) is visible.
   */
  async getRollup(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const packages = await this.repo.findWorkPackages(prisma, identity.activeOrganizationId, projectId);
    const progressLines = await this.getProjectProgress(identity, projectId);
    const pctByNode = new Map<string, number>();
    for (const l of progressLines) pctByNode.set(l.boqNodeId, l.percentComplete ?? 0);

    let weightsTotal = ZERO;
    let weighted = ZERO;
    const packageLines = packages.map((wp) => {
      const leaves = wp.boqLinks.map((b) => b.boqNodeId);
      const pct = leaves.length
        ? leaves.reduce((sum, n) => sum + (pctByNode.get(n) ?? 0), 0) / leaves.length
        : 0;
      const weight = new Decimal(wp.progressWeight.toString());
      weightsTotal = weightsTotal.plus(weight);
      weighted = weighted.plus(weight.mul(pct));
      return {
        id: wp.id,
        code: wp.code,
        name: wp.name,
        responsibleOwner: wp.responsibleOwner,
        weight: weight.toString(),
        percentComplete: Math.round(pct),
        leafCount: leaves.length,
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
   * Physical-vs-financial early warning (ADR-021/023): weighted physical % (roll-up) vs cost-consumed
   * % (posted actual ÷ forecast cost, from the ADR-013 Financial Position). A large positive gap
   * (cost ahead of progress) says "investigate"; a large negative gap means progress is ahead of
   * spend (ACCO financing the client). The cost read crosses into accounting — the allowed direction.
   */
  async getPhysicalFinancialSignal(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const rollup = await this.getRollup(identity, projectId);
    const fp = await this.financialPosition.getForProject(identity, projectId);

    const forecastCost = new Decimal(fp.forecastCost);
    const actualCost = new Decimal(fp.actualCost);
    const costConsumedPercent = forecastCost.greaterThan(ZERO)
      ? Math.round(actualCost.div(forecastCost).mul(100).toNumber() * 100) / 100
      : null;

    const physicalPercent = rollup.physicalPercent;
    const { divergence, status } = classifyDivergence(
      costConsumedPercent === null ? null : physicalPercent - costConsumedPercent,
      'PROGRESS_AHEAD',
      'COST_AHEAD',
    );

    return {
      projectId,
      physicalPercent,
      actualCost: fp.actualCost,
      forecastCost: fp.forecastCost,
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
  async getCollectionProgressSignal(identity: RequestIdentity, projectId: string) {
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
      collectedPercent === null ? null : collectedPercent - physicalPercent,
      'CASH_AHEAD',
      'WORK_AHEAD',
    );

    return {
      projectId,
      physicalPercent,
      contractValue: fp.contractValue,
      receivedRevenue: fp.receivedRevenue,
      collectedPercent,
      divergence,
      status,
      weightsComplete: rollup.weightsComplete,
    };
  }
}

export interface CreateWorkPackageDto {
  code: string;
  name: string;
  responsibleOwner?: string;
  progressWeight?: number;
}
