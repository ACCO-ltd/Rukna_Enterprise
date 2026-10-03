import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../../accounting/accounting-core/accounting-core.module.js';
import { FinancialPositionModule } from '../../accounting/financial-position/financial-position.module.js';
import { ProjectProcurementModule } from '../../procurement/project-procurement/project-procurement.module.js';
import { CommercialModule } from '../commercial/commercial.module.js';
import { FinanceCashflowService } from './application/finance-cashflow.service.js';
import { FinancePortfolioService } from './application/finance-portfolio.service.js';
import { FinanceCashflowController } from './presentation/finance-cashflow.controller.js';
import { FinancePortfolioController } from './presentation/finance-portfolio.controller.js';

/**
 * ADR-043 — Finance workspace portfolio read model (`GET /finance/projects`). Read-only; composes
 * the commercial, accounting and procurement repositories (construction → accounting, per
 * ARCH-BOUNDARY-001). ProjectAccessService comes from the global ProjectAccessModule.
 */
@Module({
  imports: [TenancyModule, AccountingCoreModule, FinancialPositionModule, ProjectProcurementModule, CommercialModule],
  providers: [FinancePortfolioService, FinanceCashflowService],
  controllers: [FinancePortfolioController, FinanceCashflowController],
})
export class FinancePortfolioModule {}
