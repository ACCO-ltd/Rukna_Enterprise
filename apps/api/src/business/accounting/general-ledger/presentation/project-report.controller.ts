import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { PLReportService } from '../application/pl-report.service.js';
import { PLQueryDto } from './dto/report-query.dto.js';

/**
 * Project-scoped convenience wrapper over the P&L report (ADR-013).
 *
 * This is the **Project Actual P&L** — posted GL truth only (project revenue and
 * project-cost lines that carry projectId). It deliberately excludes committed and
 * forecast cost: those belong to the separate Project Financial Position read model,
 * never to the accounting P&L. Do not present this to a PM as the complete picture.
 */
@ApiTags('Financial Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingView)
@Controller('projects')
export class ProjectReportController {
  constructor(private readonly plReportService: PLReportService) {}

  @Get(':id/pl')
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiOperation({
    summary: 'Project Actual P&L (posted GL only)',
    description:
      'Profit & Loss filtered to this project via journal-line projectId. Posted actuals ' +
      'only — excludes committed/forecast cost, which live in Project Financial Position. ' +
      'The path project id overrides any projectId in the query.',
  })
  getProjectPL(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') projectId: string,
    @Query() query: PLQueryDto,
  ) {
    return this.plReportService.generate(identity, { ...query, projectId });
  }
}
