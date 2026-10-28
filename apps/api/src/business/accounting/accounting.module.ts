import { Module } from '@nestjs/common';
import { AccountingCoreModule } from './accounting-core/accounting-core.module.js';
import { ManualJournalsModule } from './manual-journals/manual-journals.module.js';
import { AccountsReceivableModule } from './accounts-receivable/accounts-receivable.module.js';
import { AccountsPayableModule } from './accounts-payable/accounts-payable.module.js';
import { GeneralLedgerModule } from './general-ledger/general-ledger.module.js';
import { FinancialPositionModule } from './financial-position/financial-position.module.js';
import { AccountingSetupModule } from './accounting-setup/accounting-setup.module.js';
import { FinanceHomeModule } from './finance-home/finance-home.module.js';
import { FinanceAttachmentsModule } from './finance-attachments/finance-attachments.module.js';
import { SetupImportModule } from './setup-import/setup-import.module.js';
import { VatReportModule } from './vat-report/vat-report.module.js';

@Module({
  imports: [
    AccountingCoreModule,
    ManualJournalsModule,
    AccountsReceivableModule,
    AccountsPayableModule,
    GeneralLedgerModule,
    FinancialPositionModule,
    AccountingSetupModule,
    FinanceHomeModule,
    FinanceAttachmentsModule,
    SetupImportModule,
    VatReportModule,
  ],
  exports: [
    AccountingCoreModule,
    ManualJournalsModule,
    AccountsReceivableModule,
    AccountsPayableModule,
  ],
})
export class AccountingModule {}
