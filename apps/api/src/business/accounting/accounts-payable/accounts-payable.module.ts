import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { CommitmentLedgerModule } from '../../procurement/commitment-ledger/commitment-ledger.module.js';
import { BillMatchingModule } from '../../procurement/bill-matching/bill-matching.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { SupplierBillRepository } from './infrastructure/supplier-bill.repository.js';
import { SupplierPaymentRepository } from './infrastructure/supplier-payment.repository.js';
import { SupplierRepository } from './infrastructure/supplier.repository.js';
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
  ],
  controllers: [SupplierBillController, SupplierPaymentController, SupplierController, PostingProfileController],
  providers: [
    SupplierBillRepository,
    SupplierPaymentRepository,
    SupplierRepository,
    SupplierBillService,
    SupplierPaymentService,
    SupplierService,
  ],
  exports: [SupplierBillService, SupplierPaymentService, SupplierService],
})
export class AccountsPayableModule {}
