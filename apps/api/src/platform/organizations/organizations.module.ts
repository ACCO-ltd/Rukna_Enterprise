import { Module } from '@nestjs/common';

import { OrganizationsController } from './presentation/organizations.controller.js';
import { OrganizationsService } from './application/organizations.service.js';
import { OrganizationsPrismaRepository } from './infrastructure/organizations-prisma.repository.js';

@Module({
  controllers: [OrganizationsController],
  providers: [
    OrganizationsService,
    { provide: 'IOrganizationsRepository', useClass: OrganizationsPrismaRepository },
  ],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
