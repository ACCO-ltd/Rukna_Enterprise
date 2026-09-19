import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { CommitmentLedgerModule } from '../../procurement/commitment-ledger/commitment-ledger.module.js';
import { BillMatchingModule } from '../../procurement/bill-matching/bill-matching.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { PurchaseOrdersModule } from '../../procurement/purchase-orders/purchase-orders.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { SupplierBillRepository } from './infrastructure/supplier-bill.repository.js';
import { SupplierPaymentRepository } from './infrastructure/supplier-payment.repository.js';
import { SupplierRepository } from './infrastructure/supplier.repository.js';
import { PurchaseAllocationRepository } from './infrastructure/purchase-allocation.repository.js';
import { BuyerAdvanceRepository } from './infrastructure/buyer-advance.repository.js';
import { BuyerAdvanceService } from './application/buyer-advance.service.js';
import { BuyerAdvanceController } from './presentation/buyer-advance.controller.js';
import { SupplierBillService } from './application/supplier-bill.service.js';
import { SupplierPaymentService } from './application/supplier-payment.service.js';
import { SupplierService } from './application/supplier.service.js';
import { SupplierBillController } from './presentation/supplier-bill.controller.js';
import { SupplierPaymentController } from './presentation/supplier-payment.controller.js';
import { SupplierController } from './presentation/supplier.controller.js';
import { PostingProfileController } from './presentation/posting-profile.controller.js';

@Module({
  imports: [
    TenancyModule,
    AccountingCoreModule,
    CommitmentLedgerModule,
    BillMatchingModule,
    WorkflowsModule,
    AuditLogsModule,
    PurchaseOrdersModule,
  ],
  controllers: [SupplierBillController, SupplierPaymentController, SupplierController, PostingProfileController, BuyerAdvanceController],
  providers: [
    SupplierBillRepository,
    SupplierPaymentRepository,
    SupplierRepository,
    PurchaseAllocationRepository,
    BuyerAdvanceRepository,
    SupplierBillService,
    SupplierPaymentService,
    SupplierService,
    BuyerAdvanceService,
  ],
  exports: [SupplierBillService, SupplierPaymentService, SupplierService, BuyerAdvanceService],
})
export class AccountsPayableModule {}
