import {
  Controller, Post, Get, Body, Param,
  HttpCode, HttpStatus, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { PeriodManagementService } from '../application/period-management.service.js';
import { SnapshotService } from '../application/snapshot.service.js';
import { YearEndCloseService } from '../application/year-end-close.service.js';
import { ReopenPeriodDto } from './dto/period-action.dto.js';

@ApiTags('Period Management')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.periodsManage)
@Controller('periods')
export class PeriodController {
  constructor(
    private readonly periodManagementService: PeriodManagementService,
    private readonly snapshotService: SnapshotService,
    private readonly yearEndCloseService: YearEndCloseService,
  ) {}

  // ─── Period state transitions ─────────────────────────────────────────────────

  @Post(':id/lock')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Period ID' })
  @ApiOperation({
    summary: 'Lock an OPEN or REOPENED period (OPEN/REOPENED → LOCKED)',
    description: 'Gate: no DRAFT/SUBMITTED/APPROVED manual journals in the period.',
  })
  @ApiResponse({ status: 400, description: 'Gate check failed — blocking conditions listed' })
  lock(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.periodManagementService.lockPeriod(identity, id);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Period ID' })
  @ApiOperation({
    summary: 'Close a LOCKED period (LOCKED → CLOSED)',
    description:
      'Gate: all journals POSTED/REVERSED; AR and AP control account reconciliation must pass. ' +
      'Generates PeriodAccountBalance snapshot atomically.',
  })
  @ApiResponse({ status: 400, description: 'Gate check failed — reconciliation errors or pending journals' })
  close(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.periodManagementService.closePeriod(identity, id);
  }

  @Post(':id/reopen')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Period ID' })
  @ApiOperation({
    summary: 'Reopen a CLOSED period (CLOSED → REOPENED) — exceptional CFO action',
    description:
      'Invalidates PeriodAccountBalance snapshots for this period and all subsequent closed periods. ' +
      'Downstream periods must be rebuilt after corrections are posted.',
  })
  @ApiResponse({ status: 400, description: 'Period is not CLOSED' })
  reopen(
    @CurrentUser() identity: RequestIdentity,
    @Param('id') id: string,
    @Body() dto: ReopenPeriodDto,
  ) {
    return this.periodManagementService.reopenPeriod(identity, { periodId: id, ...dto });
  }

  @Get(':id/close-gate')
  @ApiParam({ name: 'id' })
  @ApiOperation({ summary: 'Pre-flight check: validate whether a period can be closed or locked' })
  validateCloseGate(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.periodManagementService.validateCloseGate(identity, id);
  }

  // ─── Snapshots ────────────────────────────────────────────────────────────────

  @Post(':id/snapshot/rebuild')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'id', description: 'Start period ID — rebuilds this and all subsequent CLOSED periods' })
  @ApiOperation({
    summary: 'Rebuild PeriodAccountBalance snapshots from a period forward (sequential)',
    description: 'Use after reopening and re-closing a period to restore downstream snapshot chain.',
  })
  rebuildSnapshot(@CurrentUser() identity: RequestIdentity, @Param('id') id: string) {
    return this.snapshotService.rebuildFromPeriod(
      identity.activeOrganizationId,
      id,
      identity.userId,
    );
  }

  // ─── Year-end close ───────────────────────────────────────────────────────────

  @Post('fiscal-year/:fiscalYearId/close')
  @HttpCode(HttpStatus.OK)
  @ApiParam({ name: 'fiscalYearId' })
  @ApiOperation({
    summary: 'Execute year-end close for a fiscal year',
    description:
      'Requirements: FY status OPEN, Period 12 LOCKED, Periods 1–11 CLOSED. ' +
      'Posts CLOSING journal (zero P&L to Retained Earnings), generates Period 12 snapshot, ' +
      'marks Period 12 CLOSED and FiscalYear CLOSED.',
  })
  @ApiResponse({ status: 200, description: 'Year-end close result with closing journal details' })
  @ApiResponse({ status: 400, description: 'Pre-conditions not met' })
  @ApiResponse({ status: 409, description: 'Closing journal already posted for this FY' })
  yearEndClose(
    @CurrentUser() identity: RequestIdentity,
    @Param('fiscalYearId') fiscalYearId: string,
  ) {
    return this.yearEndCloseService.closeYear(identity, fiscalYearId);
  }
}
