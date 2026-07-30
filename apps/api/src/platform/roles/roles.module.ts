import { Module } from '@nestjs/common';

import { RolesController } from './presentation/roles.controller.js';
import { RolesService } from './application/roles.service.js';
import { RolesPrismaRepository } from './infrastructure/roles-prisma.repository.js';

@Module({
  controllers: [RolesController],
  providers: [
    RolesService,
    { provide: 'IRolesRepository', useClass: RolesPrismaRepository },
  ],
  exports: [RolesService],
})
export class RolesModule {}
