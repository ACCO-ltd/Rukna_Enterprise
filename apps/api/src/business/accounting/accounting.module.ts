import { Module } from '@nestjs/common';
import { AccountingCoreModule } from './accounting-core/accounting-core.module.js';
import { ManualJournalsModule } from './manual-journals/manual-journals.module.js';
import { AccountsReceivableModule } from './accounts-receivable/accounts-receivable.module.js';
import { AccountsPayableModule } from './accounts-payable/accounts-payable.module.js';
import { GeneralLedgerModule } from './general-ledger/general-ledger.module.js';
import { FinancialPositionModule } from './financial-position/financial-position.module.js';

@Module({
  imports: [
    AccountingCoreModule,
    ManualJournalsModule,
    AccountsReceivableModule,
    AccountsPayableModule,
    GeneralLedgerModule,
    FinancialPositionModule,
  ],
  exports: [
    AccountingCoreModule,
    ManualJournalsModule,
    AccountsReceivableModule,
    AccountsPayableModule,
  ],
})
export class AccountingModule {}
