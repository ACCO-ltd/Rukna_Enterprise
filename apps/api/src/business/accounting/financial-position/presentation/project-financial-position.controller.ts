import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';

import { ProjectFinancialPositionService } from '../application/project-financial-position.service.js';
import { ProjectCostReconciliationService } from '../application/project-cost-reconciliation.service.js';

/**
 * Project Financial Position (ADR-013) — the PM/control view: posted actual cost, remaining
 * committed cost, and the forecast margin that follows. Distinct from the Project Actual P&L
 * (`GET /projects/:id/pl`), which is posted GL only and must never omit committed cost.
 */
@ApiTags('Financial Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.financialPositionView)
@ProjectScoped('projectId')
@Controller('projects/:projectId')
export class ProjectFinancialPositionController {
  constructor(
    private readonly service: ProjectFinancialPositionService,
    private readonly reconciliation: ProjectCostReconciliationService,
  ) {}

  @Get('financial-position')
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiOperation({
    summary: 'Project Financial Position (actuals + remaining commitments + forecast)',
    description:
      'Budget/certified/invoiced/received revenue with actual cost, remaining committed cost ' +
      '(COMMITTED + ACCRUED), forecast cost and forecast margin. Commitments are not GL ' +
      'expenses and never appear in the accounting P&L.',
  })
  getFinancialPosition(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.service.getForProject(identity, projectId);
  }

  @Get('cost-reconciliation')
  @ApiParam({ name: 'projectId', description: 'Project ID' })
  @ApiOperation({
    summary: "Does procurement's ACTUAL agree with the general ledger? (REC-01)",
    description:
      'Compares commitment-ledger ACTUAL against posted GL project cost whose journal came ' +
      'from a supplier bill. Source-scoped on purpose: payroll, plant, depreciation and ' +
      'manual project journals are real project cost procurement never sees, and are ' +
      'reported separately rather than counted as a variance.',
  })
  getCostReconciliation(
    @CurrentUser() identity: RequestIdentity,
    @Param('projectId') projectId: string,
  ) {
    return this.reconciliation.getForProject(identity, projectId);
  }
}
