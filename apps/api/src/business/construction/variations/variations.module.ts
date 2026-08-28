import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { BoqModule } from '../boq/boq.module.js';
import { VariationOrderPrismaRepository } from './infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from './application/variation-order.service.js';
import { ApplyVariationToBoqService } from './application/apply-variation-to-boq.service.js';
import { AdoptBaselinePrismaRepository } from './infrastructure/adopt-baseline-prisma.repository.js';
import { AdoptBaselineService } from './application/adopt-baseline.service.js';
import { ExtensionOfTimePrismaRepository } from './infrastructure/extension-of-time-prisma.repository.js';
import { ExtensionOfTimeService } from './application/extension-of-time.service.js';
import { AtRiskCommencementService } from './application/at-risk-commencement.service.js';
import { VariationsController } from './presentation/variations.controller.js';

/**
 * ADR-026 (Variations Phases 1/2/4) — the VariationOrder aggregate module. Reuses WorkflowsModule
 * (CommandGovernanceService, CONST-VAR-010), AuditLogsModule, the global ProjectAccessModule for
 * tenancy + membership, and — for Phase 2 (CONST-VAR-007) — BoqModule's BoqVersioningService to scope
 * a client-approved VO into the BOQ via the EXISTING revision mechanism (no forked baseline path).
 * Exports the repository so the commercial read model can derive contract value.
 */
@Module({
  imports: [TenancyModule, WorkflowsModule, AuditLogsModule, BoqModule],
  providers: [
    VariationOrderPrismaRepository,
    VariationOrderService,
    ApplyVariationToBoqService,
    AdoptBaselinePrismaRepository,
    AdoptBaselineService,
    ExtensionOfTimePrismaRepository,
    ExtensionOfTimeService,
    AtRiskCommencementService,
  ],
  controllers: [VariationsController],
  exports: [VariationOrderPrismaRepository],
})
export class VariationsModule {}
