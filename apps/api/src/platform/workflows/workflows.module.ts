import { Module } from '@nestjs/common';
import { WorkflowsController } from './presentation/workflows.controller.js';
import { WorkflowsService } from './application/workflows.service.js';
import { ApprovalService } from './application/approval.service.js';
import { WorkflowTriggerResolverService } from './application/workflow-trigger-resolver.service.js';
import { WorkflowsPrismaRepository } from './infrastructure/workflows-prisma.repository.js';
import { WorkflowPolicyService } from './application/workflow-policy.service.js';
import { SegregationOfDutiesService } from './application/segregation-of-duties.service.js';
import { CommandGovernanceService } from './application/command-governance.service.js';
import { GovernanceAuthoringConfig } from './application/governance-authoring.config.js';

@Module({
  controllers: [WorkflowsController],
  providers: [
    WorkflowsService,
    ApprovalService,
    WorkflowTriggerResolverService,
    WorkflowPolicyService,
    SegregationOfDutiesService,
    WorkflowsPrismaRepository,
    CommandGovernanceService,
    GovernanceAuthoringConfig,
  ],
  exports: [
    WorkflowsService,
    ApprovalService,
    WorkflowTriggerResolverService,
    WorkflowPolicyService,
    SegregationOfDutiesService,
    CommandGovernanceService,
    GovernanceAuthoringConfig,
  ],
})
export class WorkflowsModule {}
