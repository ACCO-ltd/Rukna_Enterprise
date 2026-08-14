import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';

import { ProjectFinancialPositionService } from '../application/project-financial-position.service.js';

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
  constructor(private readonly service: ProjectFinancialPositionService) {}

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
}
