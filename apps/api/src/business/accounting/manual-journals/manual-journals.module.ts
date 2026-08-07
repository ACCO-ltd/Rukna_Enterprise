import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { ManualJournalService } from './application/manual-journal.service.js';
import { ManualJournalController } from './presentation/manual-journal.controller.js';

@Module({
  imports: [TenancyModule, AccountingCoreModule],
  controllers: [ManualJournalController],
  providers: [ManualJournalService],
  exports: [ManualJournalService],
})
export class ManualJournalsModule {}
