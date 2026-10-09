import { Module } from '@nestjs/common';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { MaterialRequestsModule } from './material-requests/material-requests.module.js';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module.js';
import { GoodsReceiptsModule } from './goods-receipts/goods-receipts.module.js';
import { BillMatchingModule } from './bill-matching/bill-matching.module.js';
import { CommitmentLedgerModule } from './commitment-ledger/commitment-ledger.module.js';
import { ProjectProcurementModule } from './project-procurement/project-procurement.module.js';
import { SupplierDirectoryModule } from './supplier-directory/supplier-directory.module.js';
import { QuotationsModule } from './quotations/quotations.module.js';
import { StoreDocumentsModule } from './store-documents/store-documents.module.js';

@Module({
  imports: [
    CatalogueModule,
    CommitmentLedgerModule,
    MaterialRequestsModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    BillMatchingModule,
    ProjectProcurementModule,
    SupplierDirectoryModule,
    QuotationsModule,
    StoreDocumentsModule,
  ],
  exports: [
    CatalogueModule,
    CommitmentLedgerModule,
    MaterialRequestsModule,
    PurchaseOrdersModule,
    GoodsReceiptsModule,
    BillMatchingModule,
    ProjectProcurementModule,
  ],
})
export class ProcurementModule {}
