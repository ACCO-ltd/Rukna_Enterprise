import { Module } from '@nestjs/common';

import { WorkflowsModule } from '../workflows/workflows.module.js';
import { ApprovalsInboxController } from './presentation/approvals-inbox.controller.js';
import { ApprovalsInboxService } from './application/approvals-inbox.service.js';
import { ApprovalsInboxRepository } from './infrastructure/approvals-inbox.repository.js';

// Step 3 (ADR-049). TenancyModule and ProjectAccessModule are @Global; WorkflowsModule exports the
// segregation-of-duties evaluator.
@Module({
  imports: [WorkflowsModule],
  controllers: [ApprovalsInboxController],
  providers: [ApprovalsInboxService, ApprovalsInboxRepository],
})
export class ApprovalsInboxModule {}
