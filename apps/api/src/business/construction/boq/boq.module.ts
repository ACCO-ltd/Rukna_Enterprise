import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { BoqController } from './presentation/boq.controller.js';
import { BoqVersioningService } from './application/boq-versioning.service.js';
import { BoqTreeService } from './application/boq-tree.service.js';
import { BoqWorkspaceService } from './application/boq-workspace.service.js';
import { BoqPrismaRepository } from './infrastructure/boq-prisma.repository.js';

// WorkflowsModule supplies CommandGovernanceService for the baseline gate (CONST-BOQ-018).
@Module({
  imports: [WorkflowsModule],
  controllers: [BoqController],
  providers: [BoqVersioningService, BoqTreeService, BoqWorkspaceService, BoqPrismaRepository],
  exports: [BoqVersioningService],
})
export class BoqModule {}
