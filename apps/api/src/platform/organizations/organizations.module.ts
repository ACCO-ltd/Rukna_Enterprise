import { Module } from '@nestjs/common';

import { FilesModule } from '../files/files.module.js';
import { OrganizationsController } from './presentation/organizations.controller.js';
import { OrganizationsService } from './application/organizations.service.js';
import { OrganizationsPrismaRepository } from './infrastructure/organizations-prisma.repository.js';

@Module({
  imports: [FilesModule],
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    { provide: 'IOrganizationsRepository', useClass: OrganizationsPrismaRepository },
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
