import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { ProjectProcurementService } from '../application/project-procurement.service.js';
import { ProjectCostBudgetService } from '../application/project-cost-budget.service.js';
import { CreateProjectCostBudgetDto } from './dto/create-project-cost-budget.dto.js';
import { UpdateProjectCostBudgetDto } from './dto/update-project-cost-budget.dto.js';

/**
 * The project's procurement surface.
 *
 * Reads only, plus the project's own cost budget. Purchase orders, goods receipts, supplier bills
 * and payments are **not** here and will not be: the organisation owns those documents, the
 * project owns the cost coded onto their lines. A project view that could author a PO would be a
 * second buyer workflow to keep in step with the first.
 */
@ApiTags('Project Procurement')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@ProjectScoped('projectId')
@Controller('projects/:projectId/procurement')
export class ProjectProcurementController {
  constructor(
    private readonly service: ProjectProcurementService,
    private readonly budgets: ProjectCostBudgetService,
  ) {}

  /** `asOf` bounds on the ledger's accounting date, so "as of month end" means what it says. */
  @Get('overview')
  @RequirePermissions(PERMISSIONS.procurementView)
  @ApiOperation({ summary: "The project's cost position, pipeline, attention queue and activity" })
  @ApiParam({ name: 'projectId' })
  @ApiQuery({ name: 'asOf', required: false, description: 'ISO date; bounds on accounting date' })
  getOverview(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.service.getOverview(identity, projectId, parseAsOf(asOf));
  }

  @Get('cost')
  @RequirePermissions(PERMISSIONS.commitmentsView)
  @ApiOperation({
    summary: 'Committed / accrued / actual by BOQ, supplier and spend category, from the ledger',
  })
  @ApiParam({ name: 'projectId' })
  @ApiQuery({ name: 'asOf', required: false })
  getCost(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.service.getCost(identity, projectId, parseAsOf(asOf));
  }

  @Get('requirements')
  @RequirePermissions(PERMISSIONS.procurementView)
  @ApiOperation({ summary: "This project's material requests with estimate and ordered progress" })
  @ApiParam({ name: 'projectId' })
  getRequirements(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.service.getRequirements(identity, projectId);
  }

  // ─── Cost budget ──────────────────────────────────────────────────────────────

  @Get('budgets')
  @RequirePermissions(PERMISSIONS.commitmentsView)
  @ApiOperation({ summary: 'Cost budget versions, and the one currently baselined' })
  @ApiParam({ name: 'projectId' })
  listBudgets(@CurrentUser() identity: RequestIdentity, @Param('projectId') projectId: string) {
    return this.budgets.list(identity, projectId);
  }

  @Post('budgets')
  @RequirePermissions(PERMISSIONS.projectBudgetManage)
  @ApiOperation({ summary: 'Start a new DRAFT cost budget version' })
  @ApiParam({ name: 'projectId' })
  createBudget(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
    @Body() dto: CreateProjectCostBudgetDto,
  ) {
    return this.budgets.create(identity, projectId, dto);
  }

  @Patch('budgets/:budgetId')
  @RequirePermissions(PERMISSIONS.projectBudgetManage)
  @ApiOperation({ summary: 'Edit a DRAFT cost budget. A baselined version is immutable.' })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'budgetId' })
  updateBudget(
    @CurrentUser() identity: RequestIdentity,
    @Param('budgetId') budgetId: string,
    @Body() dto: UpdateProjectCostBudgetDto,
  ) {
    return this.budgets.update(identity, budgetId, dto);
  }

  @Post('budgets/:budgetId/baseline')
  @RequirePermissions(PERMISSIONS.projectBudgetBaseline)
  @ApiOperation({
    summary: 'Baseline a DRAFT budget, superseding the previous one in the same transaction',
  })
  @ApiParam({ name: 'projectId' })
  @ApiParam({ name: 'budgetId' })
  baselineBudget(
    @CurrentUser() identity: RequestIdentity,
    @Param('budgetId') budgetId: string,
  ) {
    return this.budgets.baseline(identity, budgetId);
  }
}

/** An unparseable `asOf` is ignored rather than defaulted — a silent wrong date is worse. */
function parseAsOf(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
