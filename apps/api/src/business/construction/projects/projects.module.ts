import { Module } from '@nestjs/common';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { ContractsModule } from '../contracts/contracts.module.js';
import { ProjectsController } from './presentation/projects.controller.js';
import { ProjectService } from './application/project.service.js';
import { ProjectPrismaRepository } from './infrastructure/project-prisma.repository.js';

@Module({
  imports: [WorkflowsModule, ContractsModule],
  controllers: [ProjectsController],
  providers: [ProjectService, ProjectPrismaRepository],
  exports: [ProjectService],
})
export class ProjectsModule {}
