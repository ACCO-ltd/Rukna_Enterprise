import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';

import { ACCOUNTING_POSTING_PORT } from './application/ports/accounting-posting.port.js';

import { AccountingConfigurationRepository } from './infrastructure/accounting-configuration.repository.js';
import { FiscalYearRepository } from './infrastructure/fiscal-year.repository.js';
import { AccountRepository } from './infrastructure/account.repository.js';
import { BankAccountRepository } from './infrastructure/bank-account.repository.js';
import { DocumentSequenceRepository } from './infrastructure/document-sequence.repository.js';
import { JournalRepository } from './infrastructure/journal.repository.js';
import { AccountingPostingService } from './infrastructure/accounting-posting.service.js';

import { AccountingConfigurationService } from './application/accounting-configuration.service.js';
import { FiscalYearService } from './application/fiscal-year.service.js';
import { AccountService } from './application/account.service.js';
import { BankAccountService } from './application/bank-account.service.js';
import { OpeningBalanceService } from './application/opening-balance.service.js';
import { ReconciliationService } from './application/reconciliation.service.js';

import { AccountController } from './presentation/account.controller.js';
import { FiscalYearController } from './presentation/fiscal-year.controller.js';
import { BankAccountController } from './presentation/bank-account.controller.js';
import { OpeningBalanceController } from './presentation/opening-balance.controller.js';
import { ReconciliationController } from './presentation/reconciliation.controller.js';

@Module({
  imports: [TenancyModule],
  controllers: [
    AccountController,
    FiscalYearController,
    BankAccountController,
    OpeningBalanceController,
    ReconciliationController,
  ],
  providers: [
    // Repositories
    AccountingConfigurationRepository,
    FiscalYearRepository,
    AccountRepository,
    BankAccountRepository,
    DocumentSequenceRepository,
    JournalRepository,
    // Phase 2 posting engine
    {
      provide: ACCOUNTING_POSTING_PORT,
      useClass: AccountingPostingService,
    },
    // Application services
    AccountingConfigurationService,
    FiscalYearService,
    AccountService,
    BankAccountService,
    OpeningBalanceService,
    ReconciliationService,
  ],
  exports: [
    ACCOUNTING_POSTING_PORT,
    AccountingConfigurationService,
    FiscalYearService,
    AccountService,
    BankAccountService,
    OpeningBalanceService,
    ReconciliationService,
    AccountRepository,
    FiscalYearRepository,
    DocumentSequenceRepository,
    JournalRepository,
  ],
})
export class AccountingCoreModule {}
