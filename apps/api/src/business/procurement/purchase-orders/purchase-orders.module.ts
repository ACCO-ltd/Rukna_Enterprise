import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { CommitmentLedgerModule } from '../commitment-ledger/commitment-ledger.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { PurchaseOrderRepository } from './infrastructure/purchase-order.repository.js';
import { PurchaseOrderService } from './application/purchase-order.service.js';
import { PurchaseOrderController } from './presentation/purchase-order.controller.js';

@Module({
  imports: [TenancyModule, CatalogueModule, CommitmentLedgerModule, AuditLogsModule],
  controllers: [PurchaseOrderController],
  providers: [PurchaseOrderRepository, PurchaseOrderService],
  exports: [PurchaseOrderService, PurchaseOrderRepository],
})
export class PurchaseOrdersModule {}
