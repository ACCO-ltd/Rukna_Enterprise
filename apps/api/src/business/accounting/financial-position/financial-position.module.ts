import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { ProjectProcurementModule } from '../../procurement/project-procurement/project-procurement.module.js';
import { ProjectFinancialPositionRepository } from './infrastructure/project-financial-position.repository.js';
import { ProjectFinancialPositionService } from './application/project-financial-position.service.js';
import { ProjectCostReconciliationService } from './application/project-cost-reconciliation.service.js';
import { ProjectFinanceOverviewService } from './application/project-finance-overview.service.js';
import { ProjectFinancialPositionController } from './presentation/project-financial-position.controller.js';

/**
 * Project Financial Position (ADR-013) — the shared reporting projection over contract / AR /
 * commitment ledger / GL. Read-only. ProjectAccessGuard is provided globally.
 */
@Module({
  imports: [TenancyModule, AccountingCoreModule, ProjectProcurementModule],
  providers: [
    ProjectFinancialPositionRepository,
    ProjectFinancialPositionService,
    ProjectCostReconciliationService,
    ProjectFinanceOverviewService,
  ],
  controllers: [ProjectFinancialPositionController],
  exports: [ProjectFinancialPositionService, ProjectCostReconciliationService],
})
export class FinancialPositionModule {}
