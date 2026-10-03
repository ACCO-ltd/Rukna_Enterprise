import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { JwtAuthGuard } from '../../../../common/guards/jwt-auth.guard.js';
import { CurrentUser } from '../../../../common/decorators/current-user.decorator.js';
import { RequirePermissions } from '../../../../common/decorators/require-permissions.decorator.js';

import { FinancePortfolioService } from '../application/finance-portfolio.service.js';
import { FinancePortfolioQueryDto } from './dto/finance-portfolio-query.dto.js';

/**
 * ADR-043 — the Finance workspace's project portfolio. Gated on `view:financial-position`, the
 * permission that already opens a project's Finance Overview (revenue, cost, margin): finance
 * roles (Finance Officer, CFO, CEO, ADMIN) hold it; the Construction Director (cost, not margin),
 * Project Manager, Site Engineer and Procurement Manager do not. Project access applies per row.
 */
@ApiTags('Finance')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@RequirePermissions(PERMISSIONS.financialPositionView)
@Controller('finance/projects')
export class FinancePortfolioController {
  constructor(private readonly service: FinancePortfolioService) {}

  @Get()
  @ApiOperation({
    summary: 'Project portfolio for the Finance workspace (read-only)',
    description:
      'One row per accessible project: contract value, billed / collected / outstanding / overdue ' +
      '(as the Commercial Overview), cost to date / committed / margin (as the Finance Overview), ' +
      'stages ready to bill, overdue invoices and supplier bills to pay. Filter by morning queue ' +
      '(TO_BILL, OVERDUE, TO_PAY), search text or project status.',
  })
  list(@CurrentUser() identity: RequestIdentity, @Query() query: FinancePortfolioQueryDto) {
    return this.service.list(identity, query);
  }
}
