import { Module } from '@nestjs/common';

import { ProgressController } from './presentation/progress.controller.js';
import { ProgressService } from './application/progress.service.js';
import { ProgressRepository } from './infrastructure/progress.repository.js';
// ARCH-BOUNDARY-001 allows construction -> accounting reads (only the reverse is forbidden).
import { FinancialPositionModule } from '../../accounting/financial-position/financial-position.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { FilesModule } from '../../../platform/files/files.module.js';

// TenancyModule and ProjectAccessModule are @Global. FilesModule is imported for the evidence
// lifecycle: attaching evidence binds the file, and approving the report freezes it.
@Module({
  imports: [FinancialPositionModule, WorkflowsModule, FilesModule],
  controllers: [ProgressController],
  providers: [ProgressService, ProgressRepository],
  exports: [ProgressService],
})
export class ProgressModule {}
