import { Module } from '@nestjs/common';

import { UsersController } from './presentation/users.controller.js';
import { UsersService } from './application/users.service.js';
import { UsersPrismaRepository } from './infrastructure/users-prisma.repository.js';

@Module({
  controllers: [UsersController],
  providers: [
    UsersService,
    { provide: 'IUsersRepository', useClass: UsersPrismaRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
