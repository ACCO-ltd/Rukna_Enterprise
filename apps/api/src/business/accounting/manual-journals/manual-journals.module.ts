import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { ManualJournalService } from './application/manual-journal.service.js';
import { ManualJournalController } from './presentation/manual-journal.controller.js';

@Module({
  imports: [TenancyModule, AccountingCoreModule, WorkflowsModule],
  controllers: [ManualJournalController],
  providers: [ManualJournalService],
  exports: [ManualJournalService],
})
export class ManualJournalsModule {}
