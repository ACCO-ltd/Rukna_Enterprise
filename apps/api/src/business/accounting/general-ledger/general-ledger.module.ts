import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';

// Application services
import { SnapshotService } from './application/snapshot.service.js';
import { LedgerService } from './application/ledger.service.js';
import { TrialBalanceService } from './application/trial-balance.service.js';
import { PLReportService } from './application/pl-report.service.js';
import { BalanceSheetService } from './application/balance-sheet.service.js';
import { PeriodManagementService } from './application/period-management.service.js';
import { YearEndCloseService } from './application/year-end-close.service.js';

// Presentation
import { ReportController } from './presentation/report.controller.js';
import { PeriodController } from './presentation/period.controller.js';

@Module({
  imports: [TenancyModule, AccountingCoreModule],
  providers: [
    // Phase 3 services — order matters for readability but not for NestJS DI
    SnapshotService,
    LedgerService,
    PLReportService,         // no deps on other GL services
    TrialBalanceService,     // depends on SnapshotService
    BalanceSheetService,     // depends on SnapshotService + PLReportService
    PeriodManagementService, // depends on SnapshotService
    YearEndCloseService,     // depends on SnapshotService + ACCOUNTING_POSTING_PORT
  ],
  controllers: [ReportController, PeriodController],
  exports: [
    SnapshotService,
    LedgerService,
    TrialBalanceService,
    PLReportService,
    BalanceSheetService,
    PeriodManagementService,
    YearEndCloseService,
  ],
})
export class GeneralLedgerModule {}
