import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { ProjectProcurementRepository } from './infrastructure/project-procurement.repository.js';
import { ProjectProcurementService } from './application/project-procurement.service.js';
import { ProjectCostBudgetService } from './application/project-cost-budget.service.js';
import { ProjectProcurementController } from './presentation/project-procurement.controller.js';

/**
 * The project's procurement surface (Phase 5).
 *
 * Read models over the commitment ledger, plus the project's own cost budget. It owns no supplier
 * document and imports no module that authors one — that boundary is the point: the organisation
 * operates POs, GRNs and bills; the project reads the cost coded onto their lines.
 */
@Module({
  imports: [TenancyModule],
  providers: [ProjectProcurementRepository, ProjectProcurementService, ProjectCostBudgetService],
  controllers: [ProjectProcurementController],
  exports: [ProjectProcurementService],
})
export class ProjectProcurementModule {}
