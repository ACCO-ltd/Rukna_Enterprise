import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { BoqModule } from '../boq/boq.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { AccountsReceivableModule } from '../../accounting/accounts-receivable/accounts-receivable.module.js';
import { VariationOrderPrismaRepository } from './infrastructure/variation-order-prisma.repository.js';
import { VariationOrderService } from './application/variation-order.service.js';
import { ApplyVariationToBoqService } from './application/apply-variation-to-boq.service.js';
import { ReverseVariationService } from './application/reverse-variation.service.js';
import { AdoptBaselinePrismaRepository } from './infrastructure/adopt-baseline-prisma.repository.js';
import { AdoptBaselineService } from './application/adopt-baseline.service.js';
import { ExtensionOfTimePrismaRepository } from './infrastructure/extension-of-time-prisma.repository.js';
import { ExtensionOfTimeService } from './application/extension-of-time.service.js';
import { ExtraWorkClassifierService } from './application/extra-work-classifier.service.js';
import { VariationsController } from './presentation/variations.controller.js';
import { ExtraWorkController } from './presentation/extra-work.controller.js';

/**
 * ADR-026 (Variations Phases 1/2/4) — the VariationOrder aggregate module. Reuses AuditLogsModule, the
 * global ProjectAccessModule for tenancy + membership, and — for Phase 2 (CONST-VAR-007) — BoqModule's
 * BoqVersioningService to scope a client-approved VO into the BOQ via the EXISTING revision mechanism.
 * Exports the repository so the commercial read model can derive contract value.
 *
 * variation-collapse — the approval workflow (submit/internal-approve/client-approve) and at-risk
 * commencement were removed, so WorkflowsModule (CommandGovernanceService) is no longer imported. A VO
 * is now raised straight to CLIENT_APPROVED + adopted in one step (ApplyVariationToBoqService
 * .raiseAndAdopt) and un-adopted by ReverseVariationService.
 *
 * ADR-029 R5 — the extra-work classifier (ExtraWorkClassifierService + ExtraWorkController) also lives
 * here, NOT in BoqModule: VariationsModule → BoqModule already exists, so BOQ must not depend on
 * Variations (a cycle). The classifier calls BoqTreeService (from BoqModule) for ABSORB/SEPARATE,
 * ApplyVariationToBoqService (local) for VARIATION, and ClientInvoiceService (from
 * AccountsReceivableModule) to bill a SEPARATE charge inline.
 *
 * ADR-029 R6/V-2 — ContractsModule is imported for ContractService.raise/lowerCurrentValueForVariation,
 * the seams the adopt/reverse commands call to move the current contract value in-transaction.
 * AccountsReceivableModule is imported for ClientInvoiceService (SEPARATE inline billing); it imports
 * only Tenancy/AccountingCore/Files — never Variations — so both edges are acyclic.
 */
@Module({
  imports: [
    TenancyModule,
    AuditLogsModule,
    BoqModule,
    ContractsModule,
    AccountsReceivableModule,
  ],
  providers: [
    VariationOrderPrismaRepository,
    VariationOrderService,
    ApplyVariationToBoqService,
    ReverseVariationService,
    AdoptBaselinePrismaRepository,
    AdoptBaselineService,
    ExtensionOfTimePrismaRepository,
    ExtensionOfTimeService,
    ExtraWorkClassifierService,
  ],
  controllers: [VariationsController, ExtraWorkController],
  // ADR-030 CONST-COM-028 (Commercial redesign P1) — export VariationOrderService too, so the
  // Commercial bill-stage orchestrator can realize variation billing (allocateVariationBilling)
  // inside its own transaction. The repository stays exported for the read models.
  exports: [VariationOrderPrismaRepository, VariationOrderService],
})
export class VariationsModule {}
