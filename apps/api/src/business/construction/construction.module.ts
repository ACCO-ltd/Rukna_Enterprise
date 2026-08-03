import { Module } from '@nestjs/common';
import { ProjectsModule } from './projects/projects.module.js';
import { BoqModule } from './boq/boq.module.js';
import { ContractsModule } from './contracts/contracts.module.js';
import { IpaModule } from './ipa/ipa.module.js';
import { IpcModule } from './ipc/ipc.module.js';

@Module({
  imports: [ProjectsModule, BoqModule, ContractsModule, IpaModule, IpcModule],
  exports: [ProjectsModule, BoqModule, ContractsModule, IpaModule, IpcModule],
})
export class ConstructionModule {}
