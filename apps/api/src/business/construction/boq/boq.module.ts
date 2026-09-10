import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { BoqController } from './presentation/boq.controller.js';
import { BoqItemLibraryController } from './presentation/boq-item-library.controller.js';
import { BoqVersioningService } from './application/boq-versioning.service.js';
import { BoqTreeService } from './application/boq-tree.service.js';
import { BoqWorkspaceService } from './application/boq-workspace.service.js';
import { BoqItemLibraryService } from './application/boq-item-library.service.js';
import { BoqImportService } from './application/boq-import.service.js';
import { BoqPrismaRepository } from './infrastructure/boq-prisma.repository.js';
import { BoqItemLibraryRepository } from './infrastructure/boq-item-library.repository.js';

// WorkflowsModule supplies CommandGovernanceService for the baseline gate (CONST-BOQ-018).
@Module({
  imports: [WorkflowsModule],
  controllers: [BoqController, BoqItemLibraryController],
  providers: [
    BoqVersioningService,
    BoqTreeService,
    BoqWorkspaceService,
    BoqItemLibraryService,
    BoqImportService,
    BoqPrismaRepository,
    BoqItemLibraryRepository,
  ],
  // BoqTreeService is exported for the R5 extra-work classifier, which lives in VariationsModule
  // (VariationsModule → BoqModule already exists; BOQ must not depend on Variations — that would be
  // a cycle). The classifier's ABSORB/SEPARATE branches call BoqTreeService directly.
  exports: [BoqVersioningService, BoqTreeService],
})
export class BoqModule {}
