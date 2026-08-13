import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module.js';
import { CommitmentLedgerModule } from '../commitment-ledger/commitment-ledger.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { GoodsReceiptRepository } from './infrastructure/goods-receipt.repository.js';
import { GoodsReceiptService } from './application/goods-receipt.service.js';
import { GoodsReceiptController } from './presentation/goods-receipt.controller.js';

@Module({
  imports: [TenancyModule, PurchaseOrdersModule, CommitmentLedgerModule, AuditLogsModule],
  controllers: [GoodsReceiptController],
  providers: [GoodsReceiptRepository, GoodsReceiptService],
  exports: [GoodsReceiptService, GoodsReceiptRepository],
})
export class GoodsReceiptsModule {}
