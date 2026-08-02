import { Module } from '@nestjs/common';
import { WorkflowsController } from './presentation/workflows.controller.js';
import { WorkflowsService } from './application/workflows.service.js';
import { ApprovalService } from './application/approval.service.js';
import { WorkflowTriggerResolverService } from './application/workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository } from './infrastructure/workflows-prisma.repository.js';

@Module({
  controllers: [WorkflowsController],
  providers: [WorkflowsService, ApprovalService, WorkflowTriggerResolverService, WorkflowsPrismaRepository],
  exports: [WorkflowsService, ApprovalService, WorkflowTriggerResolverService],
})
export class WorkflowsModule {}
