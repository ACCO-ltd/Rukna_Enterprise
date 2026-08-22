import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { PurchaseOrdersModule } from '../purchase-orders/purchase-orders.module.js';
import { CommitmentLedgerModule } from '../commitment-ledger/commitment-ledger.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { GoodsReceiptRepository } from './infrastructure/goods-receipt.repository.js';
import { ReceiptExceptionRepository } from './infrastructure/receipt-exception.repository.js';
import { GoodsReceiptService } from './application/goods-receipt.service.js';
import { ReceiptExceptionService } from './application/receipt-exception.service.js';
import { GoodsReceiptController } from './presentation/goods-receipt.controller.js';
import { ReceiptExceptionController } from './presentation/receipt-exception.controller.js';

@Module({
  imports: [TenancyModule, PurchaseOrdersModule, CommitmentLedgerModule, AuditLogsModule, WorkflowsModule],
  controllers: [GoodsReceiptController, ReceiptExceptionController],
  providers: [GoodsReceiptRepository, ReceiptExceptionRepository, GoodsReceiptService, ReceiptExceptionService],
  exports: [GoodsReceiptService, GoodsReceiptRepository],
})
export class GoodsReceiptsModule {}
