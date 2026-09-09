import { Module } from '@nestjs/common';

import { ProgressController } from './presentation/progress.controller.js';
import { ProgressService } from './application/progress.service.js';
import { ProgressRepository } from './infrastructure/progress.repository.js';
import { ProgrammeBaselineService } from './application/programme-baseline.service.js';
import { ProgrammeBaselineRepository } from './infrastructure/programme-baseline.repository.js';
// ARCH-BOUNDARY-001 allows construction -> accounting reads (only the reverse is forbidden).
import { FinancialPositionModule } from '../../accounting/financial-position/financial-position.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { FilesModule } from '../../../platform/files/files.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';

// TenancyModule and ProjectAccessModule are @Global. FilesModule is imported for the evidence
// lifecycle: attaching evidence binds the file, and approving the report freezes it. AuditLogsModule
// provides the transactional audit-outbox the programme-baseline freeze records against.
@Module({
  imports: [FinancialPositionModule, WorkflowsModule, FilesModule, AuditLogsModule],
  controllers: [ProgressController],
  providers: [
    ProgressService,
    ProgressRepository,
    ProgrammeBaselineService,
    ProgrammeBaselineRepository,
  ],
  exports: [ProgressService, ProgrammeBaselineService],
})
export class ProgressModule {}
