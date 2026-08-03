import { Module } from '@nestjs/common';
import { ProjectsModule } from './projects/projects.module.js';
import { BoqModule } from './boq/boq.module.js';
import { ContractsModule } from './contracts/contracts.module.js';

@Module({
  imports: [ProjectsModule, BoqModule, ContractsModule],
  exports: [ProjectsModule, BoqModule, ContractsModule],
})
export class ConstructionModule {}
