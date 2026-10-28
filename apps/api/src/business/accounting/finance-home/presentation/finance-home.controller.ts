import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { RequireAnyPermission } from '../../../../common/decorators/require-permissions.decorator.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { FinanceHomeService } from '../application/finance-home.service.js';

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
