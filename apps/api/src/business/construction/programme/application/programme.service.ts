import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { MilestoneReleaseLine, ProgrammeMilestoneResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProgrammeRepository } from '../infrastructure/programme.repository.js';
import type { CreateMilestoneDto, VerifyMilestoneDto } from '../presentation/dto/programme.dto.js';

/**
 * ADR-021 phase 2 — programme delivery milestones. A milestone is a named construction stage with a
 * baseline date; an authorized project member VERIFIES it when the stage is complete, recording the
 * actual date. A verified milestone is the billing evidence a MILESTONE payment installment may
 * reference (ADR-023 CONST-COM-011). Activities, the progress-target curve and version snapshots are
 * later increments.
 */
@Injectable()
export class ProgrammeService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProgrammeRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async createMilestone(identity: RequestIdentity, projectId: string, dto: CreateMilestoneDto) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.createMilestone(this.tenancy.getClient(), {
      organizationId: identity.activeOrganizationId,
      projectId,
      code: dto.code,
      name: dto.name,
      baselineDate: new Date(dto.baselineDate),
      forecastDate: dto.forecastDate ? new Date(dto.forecastDate) : null,
      sortOrder: dto.sortOrder ?? 0,
      createdBy: identity.userId,
    });
  }

  async listMilestones(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProgrammeMilestoneResponse[]> {
    await this.projectAccess.assertMember(identity, projectId);
    const milestones = await this.repo.findMilestones(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
    );
    return milestones.map((m) => toMilestoneResponse(m));
  }

  /** Verify a milestone — the stage is complete. Only a PLANNED milestone can be verified. */
  async verifyMilestone(identity: RequestIdentity, milestoneId: string, dto: VerifyMilestoneDto) {
    const prisma = this.tenancy.getClient();
    const milestone = await this.repo.findMilestoneById(
      prisma,
      identity.activeOrganizationId,
      milestoneId,
    );
    if (!milestone) throw new NotFoundException(`Milestone ${milestoneId} not found`);
    await this.projectAccess.assertMember(identity, milestone.projectId);
    if (milestone.status !== 'PLANNED') {
      throw new BadRequestException(`Only a PLANNED milestone can be verified (is ${milestone.status}).`);
    }
    return this.repo.verifyMilestone(prisma, milestoneId, new Date(dto.actualDate), identity.userId);
  }
}

// ─── Read-model mapping (Master Schedule P2) ────────────────────────────────────────
//
// Shape a stored milestone (with its included release installments) into the wire response. Only the
// fields the release projection needs are read; the input type is structural so the mapper stays
// decoupled from the generated Prisma payload type.

/** One included installment as selected by ProgrammeRepository.findMilestones. */
interface IncludedReleaseInstallment {
  id: string;
  name: string;
  percentage: Decimal;
  triggerType: MilestoneReleaseLine['triggerType'];
  contract: { contractValue: Decimal; currency: string };
  clientInvoice: { id: string } | null;
}

/** A stored milestone row with its included installments (structural, from the repo select). */
interface StoredMilestoneWithReleases {
  id: string;
  projectId: string;
  code: string;
  name: string;
  status: ProgrammeMilestoneResponse['status'];
  baselineDate: Date;
  forecastDate: Date | null;
  actualDate: Date | null;
  sortOrder: number;
  contractMilestoneId: string | null;
  verifiedBy: string | null;
  verifiedAt: Date | null;
  installments: IncludedReleaseInstallment[];
}

/** A `@db.Date` column as an ISO calendar date (YYYY-MM-DD); a timestamp as full ISO. Null passes through. */
function isoDate(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

/**
 * Derive one release line. `amount` = contractValue × percentage, fixed to 2 decimals with Decimal —
 * identical rounding to the commercial payment schedule (buildPaymentSchedule). `invoiced` reflects
 * whether a ClientInvoice was generated from this installment (the 1:1 clientInvoice relation exists).
 */
function toReleaseLine(inst: IncludedReleaseInstallment): MilestoneReleaseLine {
  const amount = new Decimal(inst.contract.contractValue.toString()).mul(
    new Decimal(inst.percentage.toString()),
  );
  return {
    installmentId: inst.id,
    name: inst.name,
    percentage: inst.percentage.toString(),
    triggerType: inst.triggerType,
    amount: amount.toFixed(2),
    currency: inst.contract.currency,
    invoiced: inst.clientInvoice !== null,
  };
}

function toMilestoneResponse(m: StoredMilestoneWithReleases): ProgrammeMilestoneResponse {
  return {
    id: m.id,
    projectId: m.projectId,
    code: m.code,
    name: m.name,
    status: m.status,
    baselineDate: m.baselineDate.toISOString().slice(0, 10),
    forecastDate: isoDate(m.forecastDate),
    actualDate: isoDate(m.actualDate),
    sortOrder: m.sortOrder,
    contractMilestoneId: m.contractMilestoneId,
    verifiedBy: m.verifiedBy,
    verifiedAt: m.verifiedAt ? m.verifiedAt.toISOString() : null,
    // Installments are already ordered by (sortOrder, name) in the repo query.
    releases: m.installments.map(toReleaseLine),
  };
}
