import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { ContractPrismaRepository } from './infrastructure/contract-prisma.repository.js';
import { ContractService } from './application/contract.service.js';
import { ContractsController } from './presentation/contracts.controller.js';

@Module({
  imports: [TenancyModule, AuditLogsModule],
  providers: [ContractPrismaRepository, ContractService],
  controllers: [ContractsController],
  exports: [ContractPrismaRepository],
})
export class ContractsModule {}
