import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { CommercialModel, ParticipationModel, Prisma, Project, ProjectCategory } from '@prisma/client';
import {
  PERMISSIONS,
  type ProjectLifecycleCommand,
  type ProjectReadinessResponse,
  type ProjectWorkspaceGuidanceItemResponse,
  type ProjectWorkspaceSummaryResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  CommandGovernanceService,
  throwIfGated,
} from '../../../../platform/workflows/application/command-governance.service.js';
import {
  ProjectPrismaRepository,
  ProjectFull,
  ProjectReadinessRecord,
} from '../infrastructure/project-prisma.repository.js';
import { ContractPrismaRepository } from '../../contracts/infrastructure/contract-prisma.repository.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  evaluateReadiness,
  planEnforcement,
  APEX_WAIVABLE_START_CONDITIONS,
  type EnforcementPlan,
  type ReadinessSnapshot,
  type WaiverInput,
} from '../domain/project-readiness.policy.js';
import type { StartProjectDto } from '../presentation/dto/start-project.dto.js';
import type { CloseProjectDto } from '../presentation/dto/close-project.dto.js';
import type { CreateProjectDto } from '../presentation/dto/create-project.dto.js';
import type { UpdateProjectDto } from '../presentation/dto/update-project.dto.js';
import type { AddMemberDto } from '../presentation/dto/add-member.dto.js';
import type { SetMemberRolesDto } from '../presentation/dto/set-member-roles.dto.js';

// ADR-019 CONST-PLC-001/004: the canonical lifecycle is six states, each transition a guarded
// business command. `start` collapses the retired approve → mobilize → activate chain into one
// DRAFT → ACTIVE command; the DRAFT → ACTIVE governance binding (ADR-022) enforces the approval
// chain that `APPROVED` used to model. Cancellation is allowed from the two pre-completion states.
const CANCEL_ALLOWED_FROM = new Set(['DRAFT', 'ACTIVE']);

// ADR-026 CONST-VAR-011 (Route 7A) — the Start chain's apex (CONST-DOA-006: PM → CFO → CEO). The
// authority to waive the two MANDATORY Start conditions (project-before-contract) is that apex tier:
// CFO or CEO. A normal manager (projectsManage permission alone) can never waive them.
const START_CHAIN_APEX_ROLES: ReadonlySet<string> = new Set(['CFO', 'CEO']);

const LIFECYCLE_TRANSITIONS: Record<string, string> = {
  start: 'ACTIVE',
  'practical-completion': 'PRACTICAL_COMPLETION',
  closeout: 'CLOSEOUT',
  close: 'CLOSED',
  'reopen-to-active': 'ACTIVE',
  'reopen-to-pc': 'PRACTICAL_COMPLETION',
};

const LIFECYCLE_REQUIRED_FROM: Record<string, string> = {
  start: 'DRAFT',
  'practical-completion': 'ACTIVE',
  closeout: 'PRACTICAL_COMPLETION',
  close: 'CLOSEOUT',
  'reopen-to-active': 'PRACTICAL_COMPLETION',
  'reopen-to-pc': 'CLOSEOUT',
};

// ADR-019 CONST-PLC-009 — the forward guarded commands (+ cancel) a project's readiness can be
// queried against. The `reopen-*` commands are corrective and carry no readiness contract.
const READINESS_COMMANDS = new Set<ProjectLifecycleCommand>([
  'start',
  'practical-completion',
  'closeout',
  'close',
  'cancel',
]);

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

  async getWorkspaceSummary(
    identity: RequestIdentity,
    id: string,
  ): Promise<ProjectWorkspaceSummaryResponse> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const [project, recentActivity] = await Promise.all([
      this.repo.findWorkspaceSummary(prisma, identity.activeOrganizationId, id),
      this.repo.findRecentProjectActivity(prisma, identity.activeOrganizationId, id),
    ]);
    if (!project) throw new NotFoundException(`Project ${id} not found`);

    const mainContract = project.contracts[0] ?? null;
    const projectManager = project.members.find((member) =>
      member.roles.some((assignment) => assignment.role === 'PROJECT_MANAGER'),
    );
    const hasBaselinedBoq =
      project.boq?.versions.some((version) => version.status === 'BASELINED') ?? false;
    const contractApplicable = project.commercialModel === CommercialModel.CLIENT_CONTRACT;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const mayViewContracts = identity.permissions.includes(PERMISSIONS.contractsView);
    // The creator is enrolled as PM automatically. A delivery team is ready only after a
    // second active member joins; required-role policy remains a separate domain decision.
    const teamReady = project.members.length > 1;
    const daysRemaining = project.expectedEndDate
      ? Math.ceil((project.expectedEndDate.getTime() - Date.now()) / 86_400_000)
      : null;

    return {
      projectId: project.id,
      setup: {
        identityComplete: true,
        boqExists: project.boq !== null,
        boqBaselined: hasBaselinedBoq,
        mainContractApplicable: contractApplicable,
        mainContractExists: mainContract !== null,
        teamReady,
        completedSteps:
          1 +
          (hasBaselinedBoq ? 1 : 0) +
          (contractApplicable ? (mainContract ? 1 : 0) : 0) +
          (teamReady ? 1 : 0),
        totalSteps: contractApplicable ? 4 : 3,
      },
      responsibility: {
        projectManager: projectManager
          ? {
              id: projectManager.user.id,
              name: `${projectManager.user.firstName} ${projectManager.user.lastName}`.trim(),
            }
          : null,
        teamCount: project.members.length,
      },
      programme: {
        startDate: project.startDate?.toISOString() ?? null,
        expectedEndDate: project.expectedEndDate?.toISOString() ?? null,
        daysRemaining,
      },
      mainContract:
        mayViewContracts && mainContract
          ? {
              id: mainContract.id,
              contractNumber: mainContract.contractNumber,
              status: mainContract.status,
              startDate: mainContract.startDate?.toISOString() ?? null,
              expectedEndDate: mainContract.expectedEndDate?.toISOString() ?? null,
              contractValue: mayViewFinancials ? mainContract.contractValue.toString() : null,
              currency: mayViewFinancials ? mainContract.currency : null,
            }
          : null,
      financialsVisible: mayViewFinancials,
      recentActivity: recentActivity.map((event) => ({
        id: event.id,
        action: event.action,
        sourceCommand: event.sourceCommand,
        occurredAt: event.createdAt.toISOString(),
        actor: {
          id: event.user.id,
          name: `${event.user.firstName} ${event.user.lastName}`.trim(),
        },
      })),
    };
  }

  async getWorkspaceGuidance(
    identity: RequestIdentity,
    id: string,
  ): Promise<ProjectWorkspaceGuidanceItemResponse[]> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.repo.findWorkspaceSummary(prisma, identity.activeOrganizationId, id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);

    const items: ProjectWorkspaceGuidanceItemResponse[] = [];
    const isDraft = project.status === 'DRAFT';
    const hasBaselinedBoq =
      project.boq?.versions.some((version) => version.status === 'BASELINED') ?? false;
    const contractApplicable = project.commercialModel === CommercialModel.CLIENT_CONTRACT;
    const canManageProject = identity.permissions.includes(PERMISSIONS.projectsManage);
    const canViewBoq = identity.permissions.includes(PERMISSIONS.boqView);
    const canCreateContract = identity.permissions.includes(PERMISSIONS.contractsCreate);
    const canManageTeam = identity.permissions.includes(PERMISSIONS.projectMembersManage);

    if (isDraft && (!project.startDate || !project.expectedEndDate)) {
      items.push({
        id: 'programme-dates-missing',
        severity: 'WARNING',
        kind: 'PROGRAMME_DATES_MISSING',
        actionUrl: canManageProject ? `/projects/${id}/edit` : null,
        responsibleRole: 'PROJECT_MANAGER',
      });
    }
    if (isDraft && !hasBaselinedBoq) {
      items.push({
        id: 'boq-baseline-required',
        severity: 'WARNING',
        kind: 'BOQ_BASELINE_REQUIRED',
        actionUrl: canViewBoq ? `/projects/${id}/boq` : null,
        responsibleRole: 'QUANTITY_SURVEYOR',
      });
    }
    if (isDraft && contractApplicable && !project.contracts[0]) {
      items.push({
        id: hasBaselinedBoq ? 'main-contract-required' : 'main-contract-blocked',
        severity: hasBaselinedBoq ? 'WARNING' : 'INFO',
        kind: hasBaselinedBoq ? 'MAIN_CONTRACT_REQUIRED' : 'MAIN_CONTRACT_BLOCKED',
        actionUrl: hasBaselinedBoq
          ? canCreateContract
            ? `/contracts/new?projectId=${id}`
            : null
          : canViewBoq
            ? `/projects/${id}/boq`
            : null,
        responsibleRole: 'CONTRACT_ADMINISTRATOR',
      });
    }
    if (isDraft && project.members.length <= 1) {
      items.push({
        id: 'delivery-team-incomplete',
        severity: 'WARNING',
        kind: 'DELIVERY_TEAM_INCOMPLETE',
        actionUrl: canManageTeam ? `/projects/${id}/members` : null,
        responsibleRole: 'PROJECT_MANAGER',
      });
    }

    const order = { URGENT: 0, WARNING: 1, INFO: 2 } as const;
    return items.sort((a, b) => order[a.severity] - order[b.severity]);
  }

  /**
   * ADR-019 CONST-PLC-009 — the queryable readiness read contract. Returns *why* a project is (not)
   * ready for a lifecycle command BEFORE the command is attempted, so the UI renders a readiness
   * dashboard instead of discovering blockers through repeated failed commands. Pure read: it never
   * mutates state and (in Phase B1) never blocks the command — the ProjectReadinessPolicy holds the
   * branching logic (CONST-PLC-005).
   */
  async getReadiness(
    identity: RequestIdentity,
    id: string,
    command: string,
  ): Promise<ProjectReadinessResponse> {
    if (!READINESS_COMMANDS.has(command as ProjectLifecycleCommand)) {
      throw new BadRequestException(
        `Unknown lifecycle command '${command}'. Expected one of: ${[...READINESS_COMMANDS].join(', ')}.`,
      );
    }
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.repo.findReadinessSnapshot(prisma, identity.activeOrganizationId, id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);

    return evaluateReadiness(this.toReadinessSnapshot(project), command as ProjectLifecycleCommand);
  }

  /** Map the loaded readiness record to the pure policy's snapshot shape. */
  private toReadinessSnapshot(project: ProjectReadinessRecord): ReadinessSnapshot {
    const activeContract = project.contracts[0] ?? null;
    return {
      status: project.status,
      commercialModel: project.commercialModel,
      startDate: project.startDate,
      expectedEndDate: project.expectedEndDate,
      clientId: project.clientId,
      clientStatus: project.client?.status ?? null,
      activeContract: activeContract
        ? { status: activeContract.status, startDate: activeContract.startDate }
        : null,
      hasBaselinedBoq: project.boq?.versions.some((version) => version.status === 'BASELINED') ?? false,
      activeMemberCount: project.members.length,
    };
  }

  private readinessError(command: string, plan: EnforcementPlan): string {
    const parts: string[] = [];
    if (plan.mandatoryBlockers.length) {
      parts.push(`unmet mandatory conditions: ${plan.mandatoryBlockers.join(', ')}`);
    }
    if (plan.requiresWaiver.length) {
      parts.push(`conditions requiring an authorized waiver: ${plan.requiresWaiver.join(', ')}`);
    }
    if (plan.invalidOverrides.length) {
      parts.push(`overrides that do not target an unmet waivable condition: ${plan.invalidOverrides.join(', ')}`);
    }
    return `Cannot ${command} the project — ${parts.join('; ')}.`;
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

      // ADR-025: the district is the site segment of the project code. Required,
      // org-scoped, must be active.
      const district = await tx.district.findFirst({
        where: { id: dto.districtId, organizationId: identity.activeOrganizationId },
      });
      if (!district) throw new NotFoundException(`District ${dto.districtId} not found`);
      if (!district.active) {
        throw new BadRequestException('Cannot create a project in an inactive district');
      }

      // Project type (PTD1-PTD5): `category` is required (enforced by the DTO). The optional
      // `subtypeId`, when present, must be an ACTIVE subtype in this org whose category matches
      // the project's category — a subtype can never be paired with the wrong category.
      await this.assertSubtypeMatchesCategory(tx, identity, dto.category, dto.subtypeId);

      // The company segment (e.g. ACCO) is the org short code, set once in org settings.
      const org = await tx.organization.findUnique({
        where: { id: identity.activeOrganizationId },
        select: { shortCode: true },
      });
      if (!org?.shortCode) {
        throw new BadRequestException(
          'Organization short code is not configured — set it in settings before creating projects',
        );
      }

      const code =
        dto.code ??
        (await this.repo.allocateCode(
          tx,
          identity.activeOrganizationId,
          new Date().getUTCFullYear(),
          org.shortCode,
          district.code,
        ));

      const project = await this.repo.create(tx, {
        organizationId: identity.activeOrganizationId,
        code,
        name: dto.name,
        description: dto.description,
        // Preserve the legacy display field while new records reference the client aggregate.
        clientId: dto.clientId,
        districtId: district.id,
        category: dto.category,
        subtypeId: dto.subtypeId,
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
      ? await prisma.client.findFirst({
          where: { id: dto.clientId, organizationId: identity.activeOrganizationId },
        })
      : null;
    if (dto.clientId && !client) throw new NotFoundException(`Client ${dto.clientId} not found`);

    if (project.commercialModel === CommercialModel.INTERNAL_CAPITAL && dto.clientId) {
      throw new BadRequestException('An internal capital project cannot reference a client');
    }
    if (client?.status === 'INACTIVE') {
      throw new BadRequestException('Inactive clients cannot be assigned to projects');
    }

    // Project type (PTD1-PTD5): both fields are editable. Validate the subtype that WILL be
    // persisted against the category that WILL be persisted — using the caller's new value where
    // provided, otherwise the project's current value — so changing only the category can never
    // leave a subtype paired with the wrong category.
    const effectiveCategory = dto.category !== undefined ? dto.category : project.category;
    const effectiveSubtypeId =
      dto.subtypeId !== undefined ? dto.subtypeId : project.subtypeId ?? undefined;
    await this.assertSubtypeMatchesCategory(
      prisma,
      identity,
      effectiveCategory,
      effectiveSubtypeId,
    );

    return this.repo.update(prisma, id, {
      name: dto.name,
      description: dto.description,
      clientName: client?.name ?? dto.clientName,
      clientId: dto.clientId,
      location: dto.location,
      category: dto.category,
      subtypeId: dto.subtypeId,
      contractValue: dto.contractValue,
      currency: dto.currency,
      startDate: dto.startDate ? new Date(dto.startDate) : undefined,
      expectedEndDate: dto.expectedEndDate ? new Date(dto.expectedEndDate) : undefined,
    });
  }

  /**
   * Project type (PTD1-PTD5) — the subtype-matches-category invariant. When a `subtypeId` is
   * supplied, it must resolve to an ACTIVE ProjectSubtype in the caller's organization whose
   * `category` equals the project's effective category. A subtype from a different category, an
   * inactive one, or one from another org is a 400/404: a subtype can never be paired with the
   * wrong category. A null/undefined subtypeId is always valid (the subtype is optional).
   */
  private async assertSubtypeMatchesCategory(
    prisma: Prisma.TransactionClient | ReturnType<TenancyService['getClient']>,
    identity: RequestIdentity,
    category: ProjectCategory | null | undefined,
    subtypeId: string | null | undefined,
  ): Promise<void> {
    if (!subtypeId) return;

    const subtype = await prisma.projectSubtype.findFirst({
      where: { id: subtypeId, organizationId: identity.activeOrganizationId },
    });
    if (!subtype) throw new NotFoundException(`Project subtype ${subtypeId} not found`);
    if (subtype.status !== 'ACTIVE') {
      throw new BadRequestException('Cannot assign an inactive project subtype');
    }
    if (subtype.category !== category) {
      throw new BadRequestException(
        `Project subtype '${subtype.name}' belongs to category ${subtype.category}, not ${category}`,
      );
    }
  }

  // ─── Lifecycle commands ───────────────────────────────────────────────────────

  /**
   * ADR-019 CONST-PLC-004/006/008 — Start is a guarded command: it evaluates readiness (with any
   * per-condition waivers) BEFORE governance so an un-ready project never opens an approval instance,
   * then records the decision it introduces (`actualStartDate`, optional commencement note). An
   * unsatisfied MANDATORY condition is impossible; an unsatisfied WAIVABLE one needs an audited
   * override targeting that specific condition.
   */
  async start(identity: RequestIdentity, id: string, dto: StartProjectDto): Promise<Project> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);
    const fromStatus = project.status;

    if (fromStatus !== LIFECYCLE_REQUIRED_FROM.start) {
      throw new BadRequestException(
        `Cannot start a project with status '${fromStatus}'. Expected '${LIFECYCLE_REQUIRED_FROM.start}'.`,
      );
    }
    await this.assertNotSuspended(prisma, id);

    const plan = await this.enforceReadiness(identity, id, 'start', dto.overrides);

    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'Project', fromStatus, 'ACTIVE', id),
      'Starting this project requires workflow approval.',
    );

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, {
        status: 'ACTIVE' as never,
        actualStartDate: new Date(dto.actualStartDate),
        commencementNote: dto.commencementNote ?? null,
      });
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: 'project.start',
        eventType: 'PROJECT_START',
        idempotencyKey: `project-transition-${id}-${fromStatus}-to-ACTIVE`,
        before: { status: fromStatus },
        after: { status: 'ACTIVE' },
      });
      await this.recordWaivers(tx, identity, 'start', id, fromStatus, plan.appliedWaivers);
      return updated;
    });
  }

  /**
   * ADR-019 CONST-PLC-004/008 — Close is the strongest gate. It records the closure decision
   * (`closureDate` + `closureSummary`). Its readiness conditions (final account / commitments /
   * inventory / retention) are not yet queryable, so enforcement is a structural no-op today, but
   * the command routes through the same readiness → governance → mutation shape.
   */
  async close(identity: RequestIdentity, id: string, dto: CloseProjectDto): Promise<Project> {
    await this.projectAccess.assertMember(identity, id);
    const prisma = this.tenancyService.getClient();
    const project = await this.requireProject(prisma, identity.activeOrganizationId, id);
    const fromStatus = project.status;

    if (fromStatus !== LIFECYCLE_REQUIRED_FROM.close) {
      throw new BadRequestException(
        `Cannot close a project with status '${fromStatus}'. Expected '${LIFECYCLE_REQUIRED_FROM.close}'.`,
      );
    }
    await this.assertNotSuspended(prisma, id);

    const plan = await this.enforceReadiness(identity, id, 'close', dto.overrides);

    throwIfGated(
      await this.commandGovernance.gateStateTransition(identity, 'Project', fromStatus, 'CLOSED', id),
      'Closing this project requires workflow approval.',
    );

    return prisma.$transaction(async (tx) => {
      const updated = await this.repo.update(tx, id, {
        status: 'CLOSED' as never,
        closureDate: new Date(dto.closureDate),
        closureSummary: dto.closureSummary,
      });
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'TRANSITION',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: 'project.close',
        eventType: 'PROJECT_CLOSE',
        idempotencyKey: `project-transition-${id}-${fromStatus}-to-CLOSED`,
        before: { status: fromStatus },
        after: { status: 'CLOSED' },
      });
      await this.recordWaivers(tx, identity, 'close', id, fromStatus, plan.appliedWaivers);
      return updated;
    });
  }

  private async assertNotSuspended(prisma: ReturnType<TenancyService['getClient']>, id: string) {
    const activeSuspension = await this.repo.findActiveSuspension(prisma, id);
    if (activeSuspension) {
      throw new BadRequestException('Project is suspended. Resume it before changing status.');
    }
  }

  /**
   * Evaluate readiness + resolve waivers for a command; throw 400 with the blockers if not allowed.
   *
   * ADR-026 CONST-VAR-011 (Route 7A) — for `start`, a caller holding Start-chain apex authority
   * (CFO/CEO) may waive the two named MANDATORY conditions (`ACTIVE_MAIN_CONTRACT` /
   * `CONTRACT_START_DATE`) to begin a project before its main contract is executed. The apex flag is
   * derived from the caller's org roles and passed to the pure policy; without it those conditions
   * stay hard MANDATORY blockers for everyone.
   */
  private async enforceReadiness(
    identity: RequestIdentity,
    id: string,
    command: ProjectLifecycleCommand,
    overrides: WaiverInput[] | undefined,
  ): Promise<EnforcementPlan> {
    const prisma = this.tenancyService.getClient();
    const snapshot = await this.repo.findReadinessSnapshot(prisma, identity.activeOrganizationId, id);
    if (!snapshot) throw new NotFoundException(`Project ${id} not found`);
    const readiness = evaluateReadiness(this.toReadinessSnapshot(snapshot), command);
    const apexAuthority =
      command === 'start' && identity.roles.some((r) => START_CHAIN_APEX_ROLES.has(r));
    const plan = planEnforcement(readiness, overrides ?? [], { apexAuthority });
    if (!plan.allowed) {
      throw new BadRequestException(this.readinessError(command, plan));
    }
    return plan;
  }

  /** CONST-PLC-006 — each applied waiver is its own audit event (condition + reason + actor + time). */
  private async recordWaivers(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    command: string,
    id: string,
    fromStatus: string,
    waivers: WaiverInput[],
  ) {
    for (const waiver of waivers) {
      // CONST-VAR-011 (Route 7A): a waiver of a MANDATORY Start condition is the apex-authorised
      // at-risk-commencement exception — mark it so on the audit event.
      const apexAuthorised = APEX_WAIVABLE_START_CONDITIONS.has(waiver.condition);
      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'WAIVE',
        resourceType: 'Project',
        resourceId: id,
        sourceCommand: `project.${command}`,
        eventType: 'PROJECT_CONDITION_WAIVED',
        idempotencyKey: `project-waiver-${id}-${command}-${waiver.condition}-${fromStatus}`,
        reason: waiver.reason,
        before: { condition: waiver.condition },
        after: { condition: waiver.condition, waived: true, apexAuthorised },
      });
    }
  }

  async transition(
    identity: RequestIdentity,
    id: string,
    command: keyof typeof LIFECYCLE_TRANSITIONS,
  ): Promise<Project> {
    // Start and Close are guarded commands with evidence payloads — routed through start()/close().
    if (command === 'start' || command === 'close') {
      throw new BadRequestException(`Use the dedicated '${command}' command.`);
    }
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
      await this.commandGovernance.gateStateTransition(
        identity,
        'Project',
        fromStatus,
        toState,
        id,
      ),
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
      await this.commandGovernance.gateStateTransition(
        identity,
        'Project',
        fromStatus,
        'CANCELLED',
        id,
      ),
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

  /**
   * Corrects a member's roles without the remove/re-add churn that used to be the only way.
   * A versioned edit: the current active role rows are closed and the new set is opened in one
   * transaction, so the member is never briefly left with no roles and the history stays legible
   * (`assignedAt` / `removedAt` on each row is the audit trail).
   */
  async setMemberRoles(
    identity: RequestIdentity,
    projectId: string,
    userId: string,
    dto: SetMemberRolesDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancyService.getClient();
    await this.requireProject(prisma, identity.activeOrganizationId, projectId);

    const member = await this.repo.findActiveMember(prisma, projectId, userId);
    if (!member) throw new NotFoundException('User is not an active member of this project.');

    await prisma.$transaction(async (tx) => {
      await this.repo.deactivateMemberRoles(tx, member.id);
      await this.repo.addMemberRoles(tx, member.id, dto.roles, identity.userId);
    });

    return this.repo.findActiveMember(prisma, projectId, userId);
  }

  // ─── Internal helpers ─────────────────────────────────────────────────────────

  private async requireProject(
    prisma: ReturnType<TenancyService['getClient']>,
    organizationId: string,
    id: string,
  ) {
    const project = await this.repo.findById(prisma, organizationId, id);
    if (!project) throw new NotFoundException(`Project ${id} not found`);
    return project;
  }
}
