import { Module } from '@nestjs/common';
import { ProjectsModule } from './projects/projects.module.js';
import { BoqModule } from './boq/boq.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { IpaModule } from './ipa/ipa.module.js';
import { IpcModule } from './ipc/ipc.module.js';
import { CommercialModule } from './commercial/commercial.module.js';
import { DocumentsModule } from './documents/documents.module.js';
import { ProgressModule } from './progress/progress.module.js';

@Module({
  imports: [ProjectsModule, BoqModule, ContractsModule, IpaModule, IpcModule, CommercialModule, DocumentsModule, ProgressModule],
  exports: [ProjectsModule, BoqModule, ContractsModule, IpaModule, IpcModule, CommercialModule, DocumentsModule, ProgressModule],
})
export class ConstructionModule {}
