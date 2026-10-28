import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { VatReportService } from '../application/vat-report.service.js';

/** Step 6 — the VAT report, a ledger report: readable by whoever reads the accounts. */
@ApiTags('Accounting')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequireAnyPermission(PERMISSIONS.accountingView, PERMISSIONS.accountingManage)
@Controller('finance/vat-report')
export class VatReportController {
  constructor(private readonly service: VatReportService) {}

  @Get()
  @ApiOperation({ summary: 'Output VAT for a period from the ledger, by rate and document; input VAT for information' })
  report(@CurrentUser() identity: RequestIdentity, @Query('from') from = '', @Query('to') to = '') {
    return this.service.report(identity, from, to);
  }
}
