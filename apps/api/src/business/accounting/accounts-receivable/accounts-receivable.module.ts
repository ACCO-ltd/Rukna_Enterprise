import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { ClientInvoiceRepository } from './infrastructure/client-invoice.repository.js';
import { PaymentReceiptArRepository } from './infrastructure/payment-receipt-ar.repository.js';
import { ClientInvoiceService } from './application/client-invoice.service.js';
import { CustomerReceiptService } from './application/customer-receipt.service.js';
import { ClientInvoiceController } from './presentation/client-invoice.controller.js';
import { CustomerReceiptController } from './presentation/customer-receipt.controller.js';

@Module({
  imports: [TenancyModule, AccountingCoreModule],
  controllers: [ClientInvoiceController, CustomerReceiptController],
  providers: [
    ClientInvoiceRepository,
    PaymentReceiptArRepository,
    ClientInvoiceService,
    CustomerReceiptService,
  ],
  exports: [ClientInvoiceService, CustomerReceiptService],
})
export class AccountsReceivableModule {}
