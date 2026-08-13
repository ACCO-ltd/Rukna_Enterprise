import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { IpcPrismaRepository } from './infrastructure/ipc-prisma.repository.js';
import { IpcService } from './application/ipc.service.js';
import { IpcController } from './presentation/ipc.controller.js';

@Module({
  imports: [TenancyModule, AuditLogsModule],
  providers: [IpcPrismaRepository, IpcService],
  controllers: [IpcController],
  exports: [IpcPrismaRepository],
})
export class IpcModule {}
