import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProgressRepository } from '../infrastructure/progress.repository.js';

const ZERO = new Decimal(0);

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
    if (dpr.status !== 'DRAFT' && dpr.status !== 'RETURNED') {
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
    if (dpr.status !== 'DRAFT' && dpr.status !== 'RETURNED') {
      throw new BadRequestException(`Cannot submit a ${dpr.status} report.`);
    }
    return this.repo.updateDprStatus(this.tenancy.getClient(), dprId, {
      status: 'SUBMITTED',
      submittedBy: identity.userId,
      submittedAt: new Date(),
    });
  }

  /** Approve → measurements become verified. Enforces the cumulative ≤ BOQ-scope invariant first. */
  async approve(identity: RequestIdentity, dprId: string) {
    const prisma = this.tenancy.getClient();
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== 'SUBMITTED') {
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
      status: 'APPROVED',
      approvedBy: identity.userId,
      approvedAt: new Date(),
    });
  }

  async returnForRevision(identity: RequestIdentity, dprId: string, reason: string) {
    const dpr = await this.requireDpr(identity, dprId);
    if (dpr.status !== 'SUBMITTED') {
      throw new BadRequestException('Only a SUBMITTED report can be returned.');
    }
    return this.repo.updateDprStatus(this.tenancy.getClient(), dprId, {
      status: 'RETURNED',
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
}
