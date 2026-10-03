import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';

import { FinanceCashflowService } from '../application/finance-cashflow.service.js';
import { CashflowQueryDto } from './dto/cashflow-query.dto.js';

/**
 * ADR-043 Phase 4 — the cash-flow forecast. Same gate as the Finance portfolio
 * (`view:financial-position`); organisation-scoped; project access applies (a `projectId` outside
 * the caller's projects is 404 / 403, the portfolio covers only the projects they may see).
 */
@ApiTags('Finance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.financialPositionView)
@Controller('finance/cashflow')
export class FinanceCashflowController {
  constructor(private readonly service: FinanceCashflowService) {}

  @Get()
  @ApiOperation({
    summary: 'Cash-flow forecast by week or month, per currency (read-only)',
    description:
      'Inflows (posted invoices outstanding by due date; unbilled payment-schedule stages by expected bill date + ' +
      'contract terms) and outflows (posted supplier bills outstanding by due date; open purchase-order commitments by ' +
      'expected delivery + supplier terms), net and cumulative net. Past-due items sit in the first "NOW" bucket, ' +
      'items with no derivable date in "UNDATED". A `basis` note per line explains each assumption.',
  })
  forecast(@CurrentUser() identity: RequestIdentity, @Query() query: CashflowQueryDto) {
    return this.service.forecast(identity, query);
  }
}
