import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { BoqModule } from '../boq/boq.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { VariationOrderPrismaRepository } from './infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from './application/variation-order.service.js';
import { ApplyVariationToBoqService } from './application/apply-variation-to-boq.service.js';
import { AdoptBaselinePrismaRepository } from './infrastructure/adopt-baseline-prisma.repository.js';
import { AdoptBaselineService } from './application/adopt-baseline.service.js';
import { ExtensionOfTimePrismaRepository } from './infrastructure/extension-of-time-prisma.repository.js';
import { ExtensionOfTimeService } from './application/extension-of-time.service.js';
import { AtRiskCommencementService } from './application/at-risk-commencement.service.js';
import { ExtraWorkClassifierService } from './application/extra-work-classifier.service.js';
import { VariationsController } from './presentation/variations.controller.js';
import { ExtraWorkController } from './presentation/extra-work.controller.js';

/**
 * ADR-026 (Variations Phases 1/2/4) — the VariationOrder aggregate module. Reuses WorkflowsModule
 * (CommandGovernanceService, CONST-VAR-010), AuditLogsModule, the global ProjectAccessModule for
 * tenancy + membership, and — for Phase 2 (CONST-VAR-007) — BoqModule's BoqVersioningService to scope
 * a client-approved VO into the BOQ via the EXISTING revision mechanism (no forked baseline path).
 * Exports the repository so the commercial read model can derive contract value.
 *
 * ADR-029 R5 — the extra-work classifier (ExtraWorkClassifierService + ExtraWorkController) also lives
 * here, NOT in BoqModule: VariationsModule → BoqModule already exists, so BOQ must not depend on
 * Variations (a cycle). The classifier calls BoqTreeService (exported from BoqModule) for
 * ABSORB/SEPARATE and VariationOrderService (local) for VARIATION.
 *
 * ADR-029 R6/V-2 — ContractsModule is imported for ContractService.raiseCurrentValueForVariation, the
 * seam ApplyVariationToBoqService calls to move the current contract value in the adopt transaction.
 * VariationsModule → ContractsModule is acyclic (ContractsModule imports BoqModule, never Variations).
 */
@Module({
  imports: [TenancyModule, WorkflowsModule, AuditLogsModule, BoqModule, ContractsModule],
  providers: [
    VariationOrderPrismaRepository,
    VariationOrderService,
    ApplyVariationToBoqService,
    AdoptBaselinePrismaRepository,
    AdoptBaselineService,
    ExtensionOfTimePrismaRepository,
    ExtensionOfTimeService,
    AtRiskCommencementService,
    ExtraWorkClassifierService,
  ],
  controllers: [VariationsController, ExtraWorkController],
  exports: [VariationOrderPrismaRepository],
})
export class VariationsModule {}
