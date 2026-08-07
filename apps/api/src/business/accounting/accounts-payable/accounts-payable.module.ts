import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { CommitmentLedgerModule } from '../../procurement/commitment-ledger/commitment-ledger.module.js';
import { SupplierBillRepository } from './infrastructure/supplier-bill.repository.js';
import { SupplierPaymentRepository } from './infrastructure/supplier-payment.repository.js';
import { SupplierBillService } from './application/supplier-bill.service.js';
import { SupplierPaymentService } from './application/supplier-payment.service.js';
import { SupplierBillController } from './presentation/supplier-bill.controller.js';
import { SupplierPaymentController } from './presentation/supplier-payment.controller.js';

@Module({
  imports: [TenancyModule, AccountingCoreModule, CommitmentLedgerModule],
  controllers: [SupplierBillController, SupplierPaymentController],
  providers: [
    SupplierBillRepository,
    SupplierPaymentRepository,
    SupplierBillService,
    SupplierPaymentService,
  ],
  exports: [SupplierBillService, SupplierPaymentService],
})
export class AccountsPayableModule {}
