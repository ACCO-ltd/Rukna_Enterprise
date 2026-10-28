import { Controller, Get, Param, ParseEnumPipe, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type AgingSide, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { FinanceHomeService } from '../application/finance-home.service.js';
import { AgingReportService } from '../application/aging-report.service.js';

/** Step 4 (ADR-047 §4) — Finance Home. Each section is gated in the service on its own permission. */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('finance/home')
export class FinanceHomeController {
  constructor(private readonly service: FinanceHomeService) {}

  @Get()
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage, PERMISSIONS.receivablesManage, PERMISSIONS.payablesManage)
  @ApiOperation({ summary: 'Cash by bank, receivables aging, payables due, and this month’s money in and out' })
  home(@CurrentUser() identity: RequestIdentity) {
    return this.service.home(identity);
  }
}

/** Step 6 — the receivables and payables aging reports. The service applies the per-side rule. */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('finance/aging')
export class AgingReportController {
  constructor(private readonly service: AgingReportService) {}

  @Get(':side')
  @RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage, PERMISSIONS.receivablesManage, PERMISSIONS.payablesManage)
  @ApiOperation({ summary: 'Open invoices or bills by party and days past due, with the documents behind each figure' })
  report(
    @CurrentUser() identity: RequestIdentity,
    @Param('side', new ParseEnumPipe({ receivables: 'receivables', payables: 'payables' })) side: AgingSide,
  ) {
    return this.service.report(identity, side);
  }
}
