import { Module } from '@nestjs/common';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { MaterialRequestsModule } from './material-requests/material-requests.module.js';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.js';
import { GoodsReceiptsModule } from './goods-receipts/goods-receipts.module.js';
import { BillMatchingModule } from './bill-matching/bill-matching.module.js';
import { CommitmentLedgerModule } from './commitment-ledger/commitment-ledger.module.js';

@Module({
  imports: [
    CatalogueModule,
    CommitmentLedgerModule,
    MaterialRequestsModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    BillMatchingModule,
  ],
  exports: [
    CatalogueModule,
    CommitmentLedgerModule,
    MaterialRequestsModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    BillMatchingModule,
  ],
})
export class ProcurementModule {}
