import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CommercialModel, ParticipationModel, Project } from '@prisma/client';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { CommandGovernanceService, throwIfGated } from '../../../../platform/workflows/application/command-governance.service.js';
import { ProjectPrismaRepository, ProjectFull } from '../infrastructure/project-prisma.repository.js';
import { ContractPrismaRepository } from '../../contracts/infrastructure/contract-prisma.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
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
    private readonly commandGovernance: CommandGovernanceService,
    private readonly repo: ProjectPrismaRepository,
    private readonly contractRepo: ContractPrismaRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  // ─── Queries ─────────────────────────────────────────────────────────────────

  async findAll(identity: RequestIdentity, status?: string) {
    const prisma = this.tenancyService.getClient();
    const projects = await this.repo.findAll(
      prisma,
      identity.activeOrganizationId,
      status,
      this.projectAccess.scopedUserId(identity),
    );
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    return projects.map(({ members, suspensions, contracts, ...project }) => ({
      ...project,
      projectManager: members[0]
        ? `${members[0].user.firstName} ${members[0].user.lastName}`.trim()
        : null,
      isSuspended: suspensions.length > 0,
      contractValue: mayViewFinancials ? (contracts[0]?.contractValue ?? null) : null,
      currency: mayViewFinancials ? (contracts[0]?.currency ?? null) : null,
    }));
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ProjectFull> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }

  // ─── Create ──────────────────────────────────────────────────────────────────

  async create(identity: RequestIdentity, dto: CreateProjectDto): Promise<Project> {
    const prisma = this.tenancyService.getClient();

    if (dto.code) {
      const duplicate = await this.repo.findByCode(prisma, identity.activeOrganizationId, dto.code);
      if (duplicate) throw new ConflictException(`Project code '${dto.code}' already exists`);
    }

    return prisma.$transaction(async (tx) => {
      const commercialModel = dto.commercialModel ?? CommercialModel.CLIENT_CONTRACT;
      const participationModel = dto.participationModel ?? ParticipationModel.SOLE;
      if (commercialModel === CommercialModel.CLIENT_CONTRACT && !dto.clientId) {
        throw new BadRequestException('A client is required for a client contract project');
      }
      if (commercialModel === CommercialModel.INTERNAL_CAPITAL && dto.clientId) {
        throw new BadRequestException('An internal capital project cannot reference a client');
      }

      const client = dto.clientId
        ? await tx.client.findFirst({
            where: { id: dto.clientId, organizationId: identity.activeOrganizationId },
          })
        : null;
      if (dto.clientId && !client) throw new NotFoundException(`Client ${dto.clientId} not found`);
      if (client?.status === 'INACTIVE') {
        throw new BadRequestException('Inactive clients cannot be assigned to new projects');
      }

      const code = dto.code ?? await this.repo.allocateCode(tx, identity.activeOrganizationId, new Date().getUTCFullYear());

      const project = await this.repo.create(tx, {
        organizationId: identity.activeOrganizationId,
        code,
        name: dto.name,
        nameAr: dto.nameAr,
        description: dto.description,
        // Preserve the legacy display field while new records reference the client aggregate.
        clientId: dto.clientId,
        clientName: client?.name ?? dto.clientName,
        location: dto.location,
        commercialModel,
        participationModel,
        contractValue: dto.contractValue,
        currency: dto.currency,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
        createdBy: identity.userId,
      });

      // A project is not initialized until its creator can administer it.
      const member = await this.repo.createMember(tx, {
        projectId: project.id,
        userId: identity.userId,
        joinedBy: identity.userId,
      });
      await this.repo.addMemberRoles(tx, member.id, ['PROJECT_MANAGER'], identity.userId);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'Project',
        resourceId: project.id,
        sourceCommand: 'project.create',
        eventType: 'PROJECT_CREATED',
        idempotencyKey: `project-create-${project.id}`,
        after: {
          code: project.code,
          name: project.name,
          clientId: project.clientId,
          status: project.status,
          initialProjectManagerUserId: identity.userId,
        },
      });

      return project;
    });
  }

  // ─── Update ──────────────────────────────────────────────────────────────────

  async update(identity: RequestIdentity, id: string, dto: UpdateProjectDto): Promise<Project> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);

    if (project.status !== 'DRAFT') {
      throw new BadRequestException('Project can only be edited in DRAFT status');
    }

    const client = dto.clientId
      ? await prisma.client.findFirst({ where: { id: dto.clientId, organizationId: identity.activeOrganizationId } })
      : null;
    if (dto.clientId && !client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    if (project.commercialModel === CommercialModel.INTERNAL_CAPITAL && dto.clientId) {
      throw new BadRequestException('An internal capital project cannot reference a client');
    }
    if (client?.status === 'INACTIVE') {
      throw new BadRequestException('Inactive clients cannot be assigned to projects');
    }

    return this.repo.update(prisma, id, {
      name: dto.name,
      nameAr: dto.nameAr,
      description: dto.description,
      clientName: client?.name ?? dto.clientName,
      clientId: dto.clientId,
      location: dto.location,
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
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);
    const fromStatus = project.status;

    const requiredFrom = LIFECYCLE_REQUIRED_FROM[command];
    const toState = LIFECYCLE_TRANSITIONS[command];

    if (fromStatus !== requiredFrom) {
      throw new BadRequestException(
        `Cannot ${command} a project with status '${fromStatus}'. Expected '${requiredFrom}'.`,
      );
    }

    // Check for active suspension — lifecycle transitions are blocked while suspended.
    const activeSuspension = await this.repo.findActiveSuspension(prisma, id);
    if (activeSuspension) {
      throw new BadRequestException('Project is suspended. Resume it before changing status.');
    }

    // Governance gate: resolver checks WorkflowRequirementPolicy, creates ApprovalInstance if
    // a binding fires. throwIfGated throws 409 with approvalInstanceId so the client can
    // redirect to the approval workflow. Returns null when no approval is required.
    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'Project', fromStatus, toState, id),
      'This project transition requires workflow approval.',
    );

    // Status update, cross-aggregate contract move (for PRACTICAL_COMPLETION), and audit
    // evidence all commit in one transaction.
    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, { status: toState as never });

      // Cross-aggregate: practical completion moves all ACTIVE contracts to FINAL_ACCOUNT_PENDING.
      if (toState === 'PRACTICAL_COMPLETION') {
        await this.contractRepo.moveActiveContractsToFinalAccount(tx, id);
      }

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: `project.${command}`,
        eventType: `PROJECT_${command.toUpperCase().replace(/-/g, '_')}`,
        idempotencyKey: `project-transition-${id}-${fromStatus}-to-${toState}`,
        before: { status: fromStatus },
        after: { status: toState },
      });

      return updated;
    });
  }

  async cancel(identity: RequestIdentity, id: string, reason: string): Promise<Project> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);
    const fromStatus = project.status;

    if (!CANCEL_ALLOWED_FROM.has(fromStatus)) {
      throw new BadRequestException(
        `Cannot cancel a project with status '${fromStatus}'. Allowed from: ${[...CANCEL_ALLOWED_FROM].join(', ')}.`,
      );
    }

    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'Project', fromStatus, 'CANCELLED', id),
      'Project cancellation requires workflow approval.',
    );

    return prisma.$transaction(async (tx) => {
      // Cancellation reason is logged as a closed suspension record for the audit trail.
      await this.repo.createSuspension(tx, {
        projectId: id,
        reason: `CANCELLED: ${reason}`,
        suspendedBy: identity.userId,
        resumedAt: new Date(),
        resumedBy: identity.userId,
      });

      const updated = await this.repo.update(tx, id, { status: 'CANCELLED' });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'CANCEL',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: 'project.cancel',
        eventType: 'PROJECT_CANCELLED',
        idempotencyKey: `project-cancel-${id}-${fromStatus}`,
        reason,
        before: { status: fromStatus },
        after: { status: 'CANCELLED' },
      });

      return updated;
    });
  }

  // ─── Suspension ──────────────────────────────────────────────────────────────

  async suspend(identity: RequestIdentity, id: string, reason: string): Promise<void> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);

    if (['CLOSED', 'CANCELLED'].includes(project.status)) {
      throw new BadRequestException(`Cannot suspend a project with status '${project.status}'.`);
    }

    const existing = await this.repo.findActiveSuspension(prisma, id);
    if (existing) throw new ConflictException('Project already has an active suspension.');

    await prisma.$transaction(async (tx) => {
      const suspension = await this.repo.createSuspension(tx, {
        projectId: id,
        reason,
        suspendedBy: identity.userId,
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'SUSPEND',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: 'project.suspend',
        eventType: 'PROJECT_SUSPENDED',
        idempotencyKey: `project-suspend-${suspension.id}`,
        reason,
        before: { status: project.status, suspended: false },
        after: { status: project.status, suspended: true },
      });
    });
  }

  async resume(identity: RequestIdentity, id: string): Promise<void> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, id);

    const existing = await this.repo.findActiveSuspension(prisma, id);
    if (!existing) throw new BadRequestException('No active suspension to resume.');

    await prisma.$transaction(async (tx) => {
      await this.repo.resolveActiveSuspension(tx, id, identity.userId);

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'RESUME',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: 'project.resume',
        eventType: 'PROJECT_RESUMED',
        idempotencyKey: `project-resume-${existing.id}`,
        before: { suspensionId: existing.id, suspended: true },
        after: { suspended: false },
      });
    });
  }

  // ─── Members ─────────────────────────────────────────────────────────────────

  async listMembers(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);
    return this.repo.findAllMembers(prisma, projectId);
  }

  async addMember(identity: RequestIdentity, projectId: string, dto: AddMemberDto) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);

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
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);

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
}
