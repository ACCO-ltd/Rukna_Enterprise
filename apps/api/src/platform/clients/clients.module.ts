import { Module } from '@nestjs/common';

import { TenancyModule } from '../tenancy/tenancy.module.js';
import { ClientsController } from './presentation/clients.controller.js';
import { ClientService } from './application/client.service.js';
import { ClientPrismaRepository } from './infrastructure/client-prisma.repository.js';

@Module({
  imports: [TenancyModule],
  controllers: [ClientsController],
  providers: [ClientService, ClientPrismaRepository],
  exports: [ClientService],
})
export class ClientsModule {}
