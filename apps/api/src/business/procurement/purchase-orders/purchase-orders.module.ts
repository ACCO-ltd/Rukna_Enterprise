import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CommitmentLedgerModule } from '../commitment-ledger/commitment-ledger.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { PurchaseOrderRepository } from './infrastructure/purchase-order.repository.js';
import { PurchaseOrderAttachmentRepository } from './infrastructure/purchase-order-attachment.repository.js';
import { SettlementQueryRepository } from './infrastructure/settlement-query.repository.js';
import { PurchaseOrderService } from './application/purchase-order.service.js';
import { SettlementQueryService } from './application/settlement-query.service.js';
import { PurchaseOrderController } from './presentation/purchase-order.controller.js';

@Module({
  imports: [TenancyModule, CatalogueModule, CommitmentLedgerModule, AuditLogsModule, WorkflowsModule],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderRepository, PurchaseOrderAttachmentRepository, SettlementQueryRepository, PurchaseOrderService, SettlementQueryService],
  exports: [PurchaseOrderService, PurchaseOrderRepository, SettlementQueryService],
})
export class PurchaseOrdersModule {}
