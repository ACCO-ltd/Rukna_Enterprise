import { Module } from '@nestjs/common';

import { ProjectSubtypeController } from './presentation/project-subtype.controller.js';
import { ProjectSubtypeService } from './application/project-subtype.service.js';
import { ProjectSubtypeRepository } from './infrastructure/project-subtype-prisma.repository.js';

// TenancyModule is @Global.
@Module({
  controllers: [ProjectSubtypeController],
  providers: [ProjectSubtypeService, ProjectSubtypeRepository],
  exports: [ProjectSubtypeService],
})
export class ProjectSubtypesModule {}
