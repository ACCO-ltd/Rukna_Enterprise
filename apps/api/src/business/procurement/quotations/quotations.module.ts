import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module.js';
import { QuotationRequestRepository } from './infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './application/quotation-access.service.js';
import { QuotationCommandRunner } from './application/quotation-command-runner.service.js';
import { QuotationQueryService } from './application/quotation-query.service.js';
import { QuotationCollectService } from './application/quotation-collect.service.js';
import { QuotationSelectionService } from './application/quotation-selection.service.js';
import { QuotationAwardService } from './application/quotation-award.service.js';
import { QuotationMaterialRequestLink } from './application/quotation-material-request-link.service.js';
import { QuotationRequestController } from './presentation/quotation-request.controller.js';

/**
 * ADR-044 — competitive quotations between an approved material request and its purchase order.
 * Depends on purchase orders (raise the order, live allocations), never on the material-request
 * module: the MR module imports this one for the cancel cascade and the detail summary.
 */
@Module({
  imports: [TenancyModule, AuditLogsModule, WorkflowsModule, PurchaseOrdersModule],
  controllers: [QuotationRequestController],
  providers: [
    QuotationRequestRepository,
    QuotationAccessService,
    QuotationCommandRunner,
    QuotationQueryService,
    QuotationCollectService,
    QuotationSelectionService,
    QuotationAwardService,
    QuotationMaterialRequestLink,
  ],
  exports: [QuotationMaterialRequestLink],
})
export class QuotationsModule {}
