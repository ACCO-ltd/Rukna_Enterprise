import { Module } from '@nestjs/common';
import { ProjectsModule } from './projects/projects.module.js';
import { BoqModule } from './boq/boq.module.js';

@Module({
  imports: [ProjectsModule, BoqModule],
  exports: [ProjectsModule, BoqModule],
})
export class ConstructionModule {}
