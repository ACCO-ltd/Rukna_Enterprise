import {
  Controller, Get, Param, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';
import { PERMISSIONS } from '@erp/types';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import type { RequestIdentity } from '@erp/types';
import { LedgerService } from '../application/ledger.service.js';
import { TrialBalanceService } from '../application/trial-balance.service.js';
import { PLReportService } from '../application/pl-report.service.js';
import { BalanceSheetService } from '../application/balance-sheet.service.js';
import { LedgerQueryDto } from './dto/ledger-query.dto.js';
import { TrialBalanceQueryDto, PLQueryDto, BalanceSheetQueryDto } from './dto/report-query.dto.js';

@ApiTags('Financial Reports')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.accountingView)
@Controller('reports')
export class ReportController {
  constructor(
    private readonly ledgerService: LedgerService,
    private readonly trialBalanceService: TrialBalanceService,
    private readonly plReportService: PLReportService,
    private readonly balanceSheetService: BalanceSheetService,
  ) {}

  // ─── General Ledger ───────────────────────────────────────────────────────────

  @Get('ledger/:accountId')
  @ApiParam({ name: 'accountId' })
  @ApiOperation({
    summary: 'Account ledger with running balance',
    description: 'Returns opening balance, all posted journal lines in the date range with running balance, and closing balance.',
  })
  getAccountLedger(
    @CurrentUser() identity: RequestIdentity,
    @Param('accountId') accountId: string,
    @Query() query: LedgerQueryDto,
  ) {
    return this.ledgerService.getAccountLedger(identity, { accountId, ...query });
  }

  @Get('gl-balance/:accountId')
  @ApiParam({ name: 'accountId' })
  @ApiQuery({ name: 'asOfDate', example: '2025-01-31' })
  @ApiOperation({ summary: 'GL balance for a single account as of a date' })
  getGlBalance(
    @CurrentUser() identity: RequestIdentity,
    @Param('accountId') accountId: string,
    @Query('asOfDate') asOfDate: string,
  ) {
    return this.ledgerService.getGlBalance(identity, accountId, asOfDate);
  }

  @Get('drill-down')
  @ApiQuery({ name: 'sourceDocumentType', example: 'CLIENT_INVOICE' })
  @ApiQuery({ name: 'sourceDocumentId' })
  @ApiOperation({ summary: 'Source document drill-down: all journals linked to a document' })
  drillDown(
    @CurrentUser() identity: RequestIdentity,
    @Query('sourceDocumentType') sourceDocumentType: string,
    @Query('sourceDocumentId') sourceDocumentId: string,
  ) {
    return this.ledgerService.drillDown(identity, sourceDocumentType, sourceDocumentId);
  }

  // ─── Trial Balance ────────────────────────────────────────────────────────────

  @Get('trial-balance')
  @ApiOperation({
    summary: 'Trial balance as of a date',
    description:
      'Three-column format: opening / period movement / closing. ' +
      'Uses frozen snapshots for CLOSED periods, live queries otherwise.',
  })
  @ApiResponse({ status: 200, description: 'Trial balance with balanced validation' })
  getTrialBalance(
    @CurrentUser() identity: RequestIdentity,
    @Query() query: TrialBalanceQueryDto,
  ) {
    return this.trialBalanceService.generate(identity, query);
  }

  // ─── Profit & Loss ────────────────────────────────────────────────────────────

  @Get('pl')
  @ApiOperation({
    summary: 'Profit & Loss report',
    description:
      'Revenue, Cost of Sales, Gross Profit, Expenses, Net Income. ' +
      'Excludes CLOSING journal entries. Supports project/department filters.',
  })
  getPL(
    @CurrentUser() identity: RequestIdentity,
    @Query() query: PLQueryDto,
  ) {
    return this.plReportService.generate(identity, query);
  }

  @Get('pl/monthly/:fiscalYearId')
  @ApiParam({ name: 'fiscalYearId' })
  @ApiQuery({ name: 'projectId', required: false })
  @ApiQuery({ name: 'departmentId', required: false })
  @ApiOperation({ summary: 'Monthly P&L comparison: one column per period in the fiscal year' })
  getPLMonthly(
    @CurrentUser() identity: RequestIdentity,
    @Param('fiscalYearId') fiscalYearId: string,
    @Query('projectId') projectId?: string,
    @Query('departmentId') departmentId?: string,
  ) {
    return this.plReportService.generateMonthlyComparison(identity, fiscalYearId, {
      projectId,
      departmentId,
    });
  }

  // ─── Balance Sheet ────────────────────────────────────────────────────────────

  @Get('balance-sheet')
  @ApiOperation({
    summary: 'Balance Sheet as of a date',
    description:
      'Assets / Liabilities / Equity with optional comparative date. ' +
      'For open fiscal years, includes Current Year Earnings. ' +
      'Uses snapshots for closed periods.',
  })
  @ApiResponse({ status: 200, description: 'Balance sheet with balanced validation' })
  getBalanceSheet(
    @CurrentUser() identity: RequestIdentity,
    @Query() query: BalanceSheetQueryDto,
  ) {
    return this.balanceSheetService.generate(identity, query);
  }
}
