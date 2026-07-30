import { Module } from '@nestjs/common';

import { PermissionsController } from './presentation/permissions.controller.js';
import { PermissionsService } from './application/permissions.service.js';
import { PermissionsPrismaRepository } from './infrastructure/permissions-prisma.repository.js';

@Module({
  controllers: [PermissionsController],
  providers: [
    PermissionsService,
    { provide: 'IPermissionsRepository', useClass: PermissionsPrismaRepository },
  ],
  exports: [PermissionsService],
})
export class PermissionsModule {}
