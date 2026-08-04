import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Project } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { WorkflowTriggerResolverService } from '../../../../platform/workflows/application/workflow-trigger-resolver.service.js';
import { ProjectPrismaRepository, ProjectFull } from '../infrastructure/project-prisma.repository.js';
import { ContractPrismaRepository } from '../../contracts/infrastructure/contract-prisma.repository.js';
import type { CreateProjectDto } from '../presentation/dto/create-project.dto.js';
import type { UpdateProjectDto } from '../presentation/dto/update-project.dto.js';
import type { AddMemberDto } from '../presentation/dto/add-member.dto.js';

// Transitions allowed from each status
const CANCEL_ALLOWED_FROM = new Set(['DRAFT', 'APPROVED', 'MOBILIZING', 'ACTIVE']);

const LIFECYCLE_TRANSITIONS: Record<string, string> = {
  approve:               'APPROVED',
  mobilize:              'MOBILIZING',
  activate:              'ACTIVE',
  'practical-completion':'PRACTICAL_COMPLETION',
  closeout:              'CLOSEOUT',
  close:                 'CLOSED',
  'reopen-to-active':    'ACTIVE',
  'reopen-to-pc':        'PRACTICAL_COMPLETION',
};

const LIFECYCLE_REQUIRED_FROM: Record<string, string> = {
  approve:               'DRAFT',
  mobilize:              'APPROVED',
  activate:              'MOBILIZING',
  'practical-completion':'ACTIVE',
  closeout:              'PRACTICAL_COMPLETION',
  close:                 'CLOSEOUT',
  'reopen-to-active':    'PRACTICAL_COMPLETION',
  'reopen-to-pc':        'CLOSEOUT',
};

@Injectable()
export class ProjectService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly triggerResolver: WorkflowTriggerResolverService,
    private readonly repo: ProjectPrismaRepository,
    private readonly contractRepo: ContractPrismaRepository,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async findAll(identity: RequestIdentity, status?: string): Promise<Project[]> {
    const prisma = this.tenancyService.getClient();
    return this.repo.findAll(prisma, identity.activeOrganizationId, status);
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ProjectFull> {
    const prisma = this.tenancyService.getClient();
    const project = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  async create(identity: RequestIdentity, dto: CreateProjectDto): Promise<Project> {
    const prisma = this.tenancyService.getClient();

    const duplicate = await this.repo.findByCode(prisma, identity.activeOrganizationId, dto.code);
    if (duplicate) throw new ConflictException(`Project code '${dto.code}' already exists`);

    const project = await this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      code: dto.code,
      name: dto.name,
      nameAr: dto.nameAr,
      description: dto.description,
      clientName: dto.clientName,
      contractValue: dto.contractValue,
      currency: dto.currency,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
      createdBy: identity.userId,
    });

    // Auto-enrol the creator so they can immediately manage members.
    const member = await this.repo.createMember(prisma, {
      projectId: project.id,
      userId: identity.userId,
      joinedBy: identity.userId,
    });
    await this.repo.addMemberRoles(prisma, member.id, ['PROJECT_MANAGER'], identity.userId);

    return project;
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  async update(identity: RequestIdentity, id: string, dto: UpdateProjectDto): Promise<Project> {
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);

    if (project.status !== 'DRAFT') {
      throw new BadRequestException('Project can only be edited in DRAFT status');
    }

    return this.repo.update(prisma, id, {
      name: dto.name,
      nameAr: dto.nameAr,
      description: dto.description,
      clientName: dto.clientName,
      contractValue: dto.contractValue,
      currency: dto.currency,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
    });
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  async transition(
    identity: RequestIdentity,
    id: string,
    command: keyof typeof LIFECYCLE_TRANSITIONS,
  ): Promise<Project> {
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);

    const requiredFrom = LIFECYCLE_REQUIRED_FROM[command];
    const toState = LIFECYCLE_TRANSITIONS[command];

    if (project.status !== requiredFrom) {
      throw new BadRequestException(
        `Cannot ${command} a project with status '${project.status}'. Expected '${requiredFrom}'.`,
      );
    }

    // Check for active suspension — lifecycle transitions are blocked while suspended.
    const activeSuspension = await this.repo.findActiveSuspension(prisma, id);
    if (activeSuspension) {
      throw new BadRequestException('Project is suspended. Resume it before changing status.');
    }

    // WorkflowRequirementPolicy check: resolver throws UnprocessableEntityException if
    // REQUIRED and no active binding. Returns null for OPTIONAL with no binding (pass-through).
    // Returns a binding when one is active — approval initiation wired in Phase 3.
    const binding = await this.triggerResolver.resolveForStateTransition(
      identity.activeOrganizationId,
      'Project',
      project.status,
      toState,
    );
    if (binding) {
      throw new UnprocessableEntityException(
        'This project transition requires workflow approval. ' +
        'Approval workflow initiation will be available once the approval engine is fully wired.',
      );
    }

    const updated = await this.repo.update(prisma, id, { status: toState as never });

    // Cross-aggregate: practical completion moves all ACTIVE contracts to FINAL_ACCOUNT_PENDING.
    if (toState === 'PRACTICAL_COMPLETION') {
      await this.contractRepo.moveActiveContractsToFinalAccount(prisma, id);
    }

    return updated;
  }

  async cancel(identity: RequestIdentity, id: string, reason: string): Promise<Project> {
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);

    if (!CANCEL_ALLOWED_FROM.has(project.status)) {
      throw new BadRequestException(
        `Cannot cancel a project with status '${project.status}'. Allowed from: ${[...CANCEL_ALLOWED_FROM].join(', ')}.`,
      );
    }

    // WorkflowRequirementPolicy check for cancellation.
    const binding = await this.triggerResolver.resolveForStateTransition(
      identity.activeOrganizationId,
      'Project',
      project.status,
      'CANCELLED',
    );
    if (binding) {
      throw new UnprocessableEntityException(
        'Project cancellation requires workflow approval. ' +
        'Approval workflow initiation will be available once the approval engine is fully wired.',
      );
    }

    // Log cancellation reason as a suspension record for audit trail.
    await this.repo.createSuspension(prisma, {
      projectId: id,
      reason: `CANCELLED: ${reason}`,
      suspendedBy: identity.userId,
      resumedAt: new Date(),
      resumedBy: identity.userId,
    });

    return this.repo.update(prisma, id, { status: 'CANCELLED' });
  }

  // ─── Suspension ──────────────────────────────────────────────────────────────

  async suspend(identity: RequestIdentity, id: string, reason: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);

    if (['CLOSED', 'CANCELLED'].includes(project.status)) {
      throw new BadRequestException(`Cannot suspend a project with status '${project.status}'.`);
    }

    const existing = await this.repo.findActiveSuspension(prisma, id);
    if (existing) throw new ConflictException('Project already has an active suspension.');

    await this.repo.createSuspension(prisma, {
      projectId: id,
      reason,
      suspendedBy: identity.userId,
    });
  }

  async resume(identity: RequestIdentity, id: string): Promise<void> {
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, id);

    const existing = await this.repo.findActiveSuspension(prisma, id);
    if (!existing) throw new BadRequestException('No active suspension to resume.');

    await this.repo.resolveActiveSuspension(prisma, id, identity.userId);
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async listMembers(identity: RequestIdentity, projectId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);
    return this.repo.findAllMembers(prisma, projectId);
  }

  async addMember(identity: RequestIdentity, projectId: string, dto: AddMemberDto) {
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);
    await this.assertMember(prisma, projectId, identity.userId);

    const existing = await this.repo.findActiveMember(prisma, projectId, dto.userId);
    if (existing) throw new ConflictException('User is already an active member of this project.');

    const member = await this.repo.createMember(prisma, {
      projectId,
      userId: dto.userId,
      joinedBy: identity.userId,
    });

    await this.repo.addMemberRoles(prisma, member.id, dto.roles, identity.userId);
    return this.repo.findActiveMember(prisma, projectId, dto.userId);
  }

  async removeMember(identity: RequestIdentity, projectId: string, userId: string) {
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);
    await this.assertMember(prisma, projectId, identity.userId);

    const member = await this.repo.findActiveMember(prisma, projectId, userId);
    if (!member) throw new NotFoundException('User is not an active member of this project.');

    await this.repo.removeMember(prisma, member.id, identity.userId);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async requireProject(prisma: ReturnType<TenancyService['getClient']>, organizationId: string, id: string) {
    const project = await this.repo.findById(prisma, organizationId, id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  async assertMember(prisma: ReturnType<TenancyService['getClient']>, projectId: string, userId: string): Promise<void> {
    const member = await this.repo.findActiveMember(prisma, projectId, userId);
    if (!member) {
      throw new ForbiddenException('You are not a member of this project.');
    }
  }
}
