import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { GeneralLedgerModule } from '../general-ledger/general-ledger.module.js';
import { CloseChecklistController } from './presentation/close-checklist.controller.js';
import { CloseChecklistService } from './application/close-checklist.service.js';
import { CloseChecklistRepository } from './infrastructure/close-checklist.repository.js';

// Step 6 — the month-end close checklist. TenancyModule is @Global.
@Module({
  imports: [AuditLogsModule, GeneralLedgerModule],
  controllers: [CloseChecklistController],
  providers: [CloseChecklistService, CloseChecklistRepository],
})
export class CloseChecklistModule {}
