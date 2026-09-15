import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { AccountsReceivableModule } from '../../accounting/accounts-receivable/accounts-receivable.module.js';
import { VariationsModule } from '../variations/variations.module.js';
import { BoqModule } from '../boq/boq.module.js';
import { CommercialPrismaRepository } from './infrastructure/commercial-prisma.repository.js';
import { CommercialService } from './application/commercial.service.js';
import { CommercialBillingService } from './application/commercial-billing.service.js';
import { CommercialController } from './presentation/commercial.controller.js';

/**
 * Project-scoped Commercial read models (ADR-017, Gate B). Mostly read-only aggregation across
 * contract / IPA / IPC / AR — construction → accounting, allowed by ARCH-BOUNDARY-001. Imports
 * VariationsModule to derive the ADR-026 contract-value figures from the VariationOrder set, and
 * BoqModule for the ADR-029 T-5 separate-charge total (via BoqVersioningService's read port) that
 * feeds total client revenue.
 *
 * ADR-030 CONST-COM-028 (Commercial redesign P1) — Commercial now also owns ONE thin variation-billing
 * WRITE path, the "bill this stage" orchestrator (CommercialBillingService): it composes the AR
 * invoice-generation service (AccountsReceivableModule → ClientInvoiceService), the variation billing
 * ledger (VariationsModule → VariationOrderService, now exported), and a package-level audit event
 * (AuditLogsModule → TransactionalAuditOutboxService) inside one transaction. Everything else in
 * Commercial stays read-only. ProjectAccessService is injected from the global ProjectAccessModule.
 */
@Module({
  imports: [TenancyModule, AuditLogsModule, AccountsReceivableModule, VariationsModule, BoqModule],
  providers: [CommercialPrismaRepository, CommercialService, CommercialBillingService],
  controllers: [CommercialController],
  exports: [CommercialService, CommercialBillingService],
})
export class CommercialModule {}
