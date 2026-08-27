import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { VariationOrderPrismaRepository } from './infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from './application/variation-order.service.js';
import { VariationsController } from './presentation/variations.controller.js';

/**
 * ADR-026 (Variations Phase 1) — the VariationOrder aggregate module. Reuses WorkflowsModule
 * (CommandGovernanceService, CONST-VAR-010) and the global ProjectAccessModule for tenancy +
 * membership. Exports the repository so the commercial read model can derive contract value.
 */
@Module({
  imports: [TenancyModule, WorkflowsModule, AuditLogsModule],
  providers: [VariationOrderPrismaRepository, VariationOrderService],
  controllers: [VariationsController],
  exports: [VariationOrderPrismaRepository],
})
export class VariationsModule {}
