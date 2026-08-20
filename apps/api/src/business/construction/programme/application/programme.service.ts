import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';

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

  async listMilestones(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findMilestones(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
    );
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
