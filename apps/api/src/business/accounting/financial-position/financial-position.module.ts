import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { ProjectFinancialPositionRepository } from './infrastructure/project-financial-position.repository.js';
import { ProjectFinancialPositionService } from './application/project-financial-position.service.js';
import { ProjectFinancialPositionController } from './presentation/project-financial-position.controller.js';

/**
 * Project Financial Position (ADR-013) — the shared reporting projection over contract / AR /
 * commitment ledger / GL. Read-only. ProjectAccessGuard is provided globally.
 */
@Module({
  imports: [TenancyModule],
  providers: [ProjectFinancialPositionRepository, ProjectFinancialPositionService],
  controllers: [ProjectFinancialPositionController],
  exports: [ProjectFinancialPositionService],
})
export class FinancialPositionModule {}
