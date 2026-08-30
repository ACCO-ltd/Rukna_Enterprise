import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { UsersController } from './presentation/users.controller.js';
import { UsersService } from './application/users.service.js';
import { UsersPrismaRepository } from './infrastructure/users-prisma.repository.js';

@Module({
  imports: [AuditLogsModule],
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: 'IUsersRepository', useClass: UsersPrismaRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
