import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { ProjectScoped } from '../../../../common/decorators/project-scoped.decorator.js';
import { ProjectAccessGuard } from '../../../../platform/project-access/project-access.guard.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';

import { PLReportService } from '../application/pl-report.service.js';
import { ProjectLedgerService } from '../application/project-ledger.service.js';
import { PLQueryDto } from './dto/report-query.dto.js';
import { ProjectLedgerQueryDto } from './dto/project-ledger-query.dto.js';

/**
 * Project-scoped accounting reports (ADR-013).
 *
 * `ProjectAccessGuard` + `@ProjectScoped` are load-bearing here. These endpoints used to be
 * gated on `view:accounting` alone, so anyone holding it could read ANY project's profit and
 * loss without being a member of it — while the Project Financial Position on the very same
 * screen was project-scoped. One tab, two different answers to "may I see this project".
 */
@ApiTags('Financial Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, ProjectAccessGuard)
@RequirePermissions(PERMISSIONS.accountingView)
@ProjectScoped('id')
@Controller('projects')
export class ProjectReportController {
  constructor(
    private readonly plReportService: PLReportService,
    private readonly projectLedger: ProjectLedgerService,
  ) {}

  /**
   * The **Project Actual P&L** — posted GL truth only (project revenue and project-cost lines
   * that carry projectId). It deliberately excludes committed and accrued cost: those belong
   * to the Project Financial Position read model, never to the accounting P&L. Do not present
   * this to a PM as the complete picture.
   */
  @Get(':id/pl')
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiOperation({
    summary: 'Project Actual P&L (posted GL only)',
    description:
      'Profit & Loss filtered to this project via journal-line projectId. Posted actuals ' +
      'only — excludes committed/accrued cost, which live in Project Financial Position. ' +
      'The path project id overrides any projectId in the query.',
  })
  getProjectPL(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') projectId: string,
    @Query() query: PLQueryDto,
  ) {
    return this.plReportService.generate(identity, { ...query, projectId });
  }

  @Get(':id/ledger')
  @ApiParam({ name: 'id', description: 'Project ID' })
  @ApiQuery({ name: 'fromDate', required: false })
  @ApiQuery({ name: 'toDate', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  @ApiOperation({
    summary: 'Every posted journal line carrying this project',
    description:
      'The drill-down beneath the project’s figures. Paged and newest-first. No running ' +
      'balance: down a project the rows are revenue, cost, receivables and cash interleaved, ' +
      'so a cumulative figure would add credits to debits. Class totals cover the whole ' +
      'filtered set, not the current page.',
  })
  getProjectLedger(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') projectId: string,
    @Query() query: ProjectLedgerQueryDto,
  ) {
    return this.projectLedger.getForProject(identity, projectId, query);
  }
}
