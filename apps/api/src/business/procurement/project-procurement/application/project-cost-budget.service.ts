import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  type ProjectCostBudgetListResponse,
  type ProjectCostBudgetResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProjectProcurementRepository } from '../infrastructure/project-procurement.repository.js';
import type { CreateProjectCostBudgetDto } from '../presentation/dto/create-project-cost-budget.dto.js';
import type { UpdateProjectCostBudgetDto } from '../presentation/dto/update-project-cost-budget.dto.js';

const ZERO = new Decimal(0);

/**
 * The project's cost budget — what it intends to spend, against which the commitment ledger is
 * read.
 *
 * **Versioned and baselined on purpose.** A budget that can be edited in place is worthless as a
 * control: the first response to an overrun is to raise the number, and the evidence that it
 * moved vanishes with it. So this follows the BOQ's pattern — DRAFT is working material,
 * BASELINED is the figure the project is measured against, and re-budgeting creates a new version
 * that supersedes the last rather than overwriting it. Exactly one BASELINED version at a time.
 *
 * It is emphatically **not** the client contract value. A BOQ rate is what the client pays;
 * comparing supplier cost against it produces a "remaining" that is really margin. The two never
 * share a column.
 */
@Injectable()
export class ProjectCostBudgetService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: ProjectProcurementRepository,
    private readonly auditOutbox: TransactionalAuditOutboxService,
  ) {}

  async list(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProjectCostBudgetListResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const [budgets, baselined] = await Promise.all([
      this.repo.findBudgets(prisma, orgId, projectId),
      this.repo.findBaselinedBudget(prisma, orgId, projectId),
    ]);

    // Every row in this list used to report `total: '0.00'`, hardcoded — so a version list
    // showed a column of zeroes beside real line counts. A budget version's total is the sum
    // of its lines; the repository now returns it.
    const totals = await this.repo.sumBudgetTotals(
      prisma,
      budgets.map((b) => b.id),
    );

    return {
      projectId,
      baselined: baselined
        ? await this.findOne(identity, baselined.id)
        : null,
      budgets: budgets.map((b) => ({
        id: b.id,
        projectId: b.projectId,
        versionNumber: b.versionNumber,
        status: b.status,
        currency: b.currency,
        notes: b.notes,
        derivedFromId: b.derivedFromId,
        total: (totals.get(b.id) ?? ZERO).toFixed(2),
        preparedBy: b.preparedBy,
        baselinedAt: b.baselinedAt?.toISOString() ?? null,
        baselinedBy: b.baselinedBy,
        lineCount: b._count.lines,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      })),
    };
  }

  async findOne(identity: RequestIdentity, id: string): Promise<ProjectCostBudgetResponse> {
    const prisma = this.tenancy.getClient();
    const budget = await this.repo.findBudgetById(prisma, identity.activeOrganizationId, id);
    if (!budget) throw new NotFoundException(`Cost budget ${id} not found`);
    await this.projectAccess.assertMember(identity, budget.projectId);
    return this.toResponse(budget);
  }

  /**
   * Start a new DRAFT budget.
   *
   * Version numbers are per project and never reused, so the history reads as a sequence even
   * after a draft is abandoned. A second DRAFT is refused: two drafts mean two answers to "what
   * are we about to baseline", and the fix is to edit the one that exists.
   */
  async create(
    identity: RequestIdentity,
    projectId: string,
    dto: CreateProjectCostBudgetDto,
  ): Promise<ProjectCostBudgetResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const existing = await prisma.projectCostBudget.findFirst({
      where: { organizationId: orgId, projectId, status: 'DRAFT' },
      select: { id: true, versionNumber: true },
    });
    if (existing) {
      throw new ConflictException(
        `Project already has a draft cost budget (version ${existing.versionNumber}). Edit or discard it first.`,
      );
    }

    const last = await prisma.projectCostBudget.findFirst({
      where: { projectId },
      orderBy: { versionNumber: 'desc' },
      select: { id: true, versionNumber: true },
    });

    const versionNumber = (last?.versionNumber ?? 0) + 1;
    const created = await prisma.$transaction(async (tx) => {
      const budget = await tx.projectCostBudget.create({
        data: {
          organizationId: orgId,
          projectId,
          versionNumber,
          currency: dto.currency,
          notes: dto.notes ?? null,
          derivedFromId: last?.id ?? null,
          preparedBy: identity.userId,
          lines: { create: dto.lines.map((line, index) => this.toLineData(line, index)) },
        },
        select: { id: true },
      });

      // A budget is a control instrument: who drafted it, who changed it and who baselined it
      // are part of the control. The BOQ's baseline has always written these; this aggregate
      // shipped without them.
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'CREATE',
        resourceType: 'ProjectCostBudget',
        resourceId: budget.id,
        sourceCommand: 'projectCostBudget.create',
        eventType: 'PROJECT_COST_BUDGET_DRAFTED',
        idempotencyKey: `project-cost-budget-create-${budget.id}`,
        after: { projectId, versionNumber, status: 'DRAFT', lineCount: dto.lines.length },
      });

      return budget;
    });

    return this.findOne(identity, created.id);
  }

  /** Replace a DRAFT's lines. A BASELINED budget is immutable — re-budget instead. */
  async update(
    identity: RequestIdentity,
    id: string,
    dto: UpdateProjectCostBudgetDto,
  ): Promise<ProjectCostBudgetResponse> {
    const prisma = this.tenancy.getClient();
    const budget = await prisma.projectCostBudget.findFirst({
      where: { id, organizationId: identity.activeOrganizationId },
      select: { id: true, projectId: true, status: true, versionNumber: true },
    });
    if (!budget) throw new NotFoundException(`Cost budget ${id} not found`);
    await this.projectAccess.assertMember(identity, budget.projectId);
    if (budget.status !== 'DRAFT') {
      throw new ConflictException(
        `Version ${budget.versionNumber} is ${budget.status.toLowerCase()} and cannot be edited. Create a new version to re-budget.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await tx.projectCostBudgetLine.deleteMany({ where: { budgetId: id } });
      await tx.projectCostBudget.update({
        where: { id },
        data: {
          ...(dto.currency ? { currency: dto.currency } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
          ...(dto.lines
            ? { lines: { create: dto.lines.map((line, index) => this.toLineData(line, index)) } }
            : {}),
        },
      });

      await this.auditOutbox.record(tx, {
        organizationId: identity.activeOrganizationId,
        actorUserId: identity.userId,
        action: 'UPDATE',
        resourceType: 'ProjectCostBudget',
        resourceId: id,
        sourceCommand: 'projectCostBudget.update',
        eventType: 'PROJECT_COST_BUDGET_EDITED',
        // Editing is repeatable, so the key carries the revision counter the row already keeps.
        idempotencyKey: `project-cost-budget-update-${id}-${Date.now()}`,
        after: { versionNumber: budget.versionNumber, lineCount: dto.lines?.length ?? null },
      });
    });

    return this.findOne(identity, id);
  }

  /**
   * Make a DRAFT the figure the project is measured against.
   *
   * Supersedes the previous BASELINED version in the same transaction, so there is never a moment
   * with two — or none. An empty budget is refused: baselining nothing would set every "% used"
   * on the project to a division by zero dressed up as control.
   */
  async baseline(identity: RequestIdentity, id: string): Promise<ProjectCostBudgetResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const budget = await prisma.projectCostBudget.findFirst({
      where: { id, organizationId: orgId },
      select: {
        id: true,
        projectId: true,
        status: true,
        versionNumber: true,
        _count: { select: { lines: true } },
      },
    });
    if (!budget) throw new NotFoundException(`Cost budget ${id} not found`);
    await this.projectAccess.assertMember(identity, budget.projectId);
    if (budget.status !== 'DRAFT') {
      throw new ConflictException(`Only a draft cost budget can be baselined.`);
    }
    if (budget._count.lines === 0) {
      throw new BadRequestException(`A cost budget must have at least one line to be baselined.`);
    }

    const now = new Date();
    await prisma.$transaction(async (tx) => {
      const superseded = await tx.projectCostBudget.updateMany({
        where: { organizationId: orgId, projectId: budget.projectId, status: 'BASELINED' },
        data: { status: 'SUPERSEDED', supersededAt: now },
      });
      await tx.projectCostBudget.update({
        where: { id },
        data: { status: 'BASELINED', baselinedAt: now, baselinedBy: identity.userId },
      });

      // Baselining sets the figure the project is measured against and supersedes the last.
      // It carries the same weight as baselining a BOQ, and needs the same evidence.
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'BASELINE',
        resourceType: 'ProjectCostBudget',
        resourceId: id,
        sourceCommand: 'projectCostBudget.baseline',
        eventType: 'PROJECT_COST_BUDGET_BASELINED',
        idempotencyKey: `project-cost-budget-baseline-${id}`,
        before: { status: 'DRAFT' },
        after: {
          status: 'BASELINED',
          versionNumber: budget.versionNumber,
          supersededVersions: superseded.count,
        },
      });
    });

    return this.findOne(identity, id);
  }

  /**
   * Abandon a DRAFT version.
   *
   * Without this a bad draft could only be edited, never dropped — and since only one DRAFT
   * may exist at a time, a mistaken version blocked starting a fresh one indefinitely. Only
   * a DRAFT can go: a BASELINED figure is what the project is measured against and a
   * SUPERSEDED one is the evidence of what it used to be, so neither is anyone's to delete.
   */
  async discard(identity: RequestIdentity, id: string): Promise<void> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const budget = await prisma.projectCostBudget.findFirst({
      where: { id, organizationId: orgId },
      select: { id: true, projectId: true, status: true, versionNumber: true },
    });
    if (!budget) throw new NotFoundException(`Cost budget ${id} not found`);
    await this.projectAccess.assertMember(identity, budget.projectId);
    if (budget.status !== 'DRAFT') {
      throw new ConflictException(
        `Version ${budget.versionNumber} is ${budget.status.toLowerCase()} and cannot be discarded. Only a draft can be abandoned.`,
      );
    }

    await prisma.$transaction(async (tx) => {
      await this.auditOutbox.record(tx, {
        organizationId: orgId,
        actorUserId: identity.userId,
        action: 'DELETE',
        resourceType: 'ProjectCostBudget',
        resourceId: id,
        sourceCommand: 'projectCostBudget.discard',
        eventType: 'PROJECT_COST_BUDGET_DISCARDED',
        idempotencyKey: `project-cost-budget-discard-${id}`,
        before: { status: 'DRAFT', versionNumber: budget.versionNumber },
      });
      // Lines cascade. The version number is not reused, so the history still reads as a
      // sequence with the abandoned attempt visible as a gap.
      await tx.projectCostBudget.delete({ where: { id } });
    });
  }

  private toLineData(
    line: { boqNodeId?: string; spendCategoryId?: string; description: string; budgetAmount: number },
    index: number,
  ) {
    // An unlabelled budget line is a number nobody can reconcile against anything, so exactly one
    // coding is required. Both is refused too: a line cannot roll up two ways at once.
    const hasBoq = Boolean(line.boqNodeId);
    const hasCategory = Boolean(line.spendCategoryId);
    if (hasBoq === hasCategory) {
      throw new BadRequestException(
        `Budget line "${line.description}" must carry exactly one of boqNodeId or spendCategoryId.`,
      );
    }
    if (line.budgetAmount < 0) {
      throw new BadRequestException(`Budget line "${line.description}" cannot be negative.`);
    }
    return {
      boqNodeId: line.boqNodeId ?? null,
      spendCategoryId: line.spendCategoryId ?? null,
      description: line.description,
      budgetAmount: new Decimal(line.budgetAmount),
      sortOrder: index,
    };
  }

  private toResponse(budget: {
    id: string;
    projectId: string;
    versionNumber: number;
    status: string;
    currency: string;
    notes: string | null;
    derivedFromId: string | null;
    preparedBy: string;
    baselinedAt: Date | null;
    baselinedBy: string | null;
    createdAt: Date;
    updatedAt: Date;
    lines: Array<{
      id: string;
      boqNodeId: string | null;
      spendCategoryId: string | null;
      description: string;
      budgetAmount: Decimal;
      sortOrder: number;
      boqNode: { code: string } | null;
      spendCategory: { name: string } | null;
    }>;
  }): ProjectCostBudgetResponse {
    const total = budget.lines.reduce(
      (sum, l) => sum.plus(new Decimal(l.budgetAmount.toString())),
      ZERO,
    );
    return {
      id: budget.id,
      projectId: budget.projectId,
      versionNumber: budget.versionNumber,
      status: budget.status as ProjectCostBudgetResponse['status'],
      currency: budget.currency,
      notes: budget.notes,
      derivedFromId: budget.derivedFromId,
      total: total.toFixed(2),
      preparedBy: budget.preparedBy,
      baselinedAt: budget.baselinedAt?.toISOString() ?? null,
      baselinedBy: budget.baselinedBy,
      lines: budget.lines.map((l) => ({
        id: l.id,
        boqNodeId: l.boqNodeId,
        boqNodeCode: l.boqNode?.code ?? null,
        spendCategoryId: l.spendCategoryId,
        spendCategoryName: l.spendCategory?.name ?? null,
        description: l.description,
        budgetAmount: new Decimal(l.budgetAmount.toString()).toFixed(2),
        sortOrder: l.sortOrder,
      })),
      createdAt: budget.createdAt.toISOString(),
      updatedAt: budget.updatedAt.toISOString(),
    };
  }
}
