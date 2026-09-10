import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { FilesModule } from '../../../platform/files/files.module.js';
import { BoqModule } from '../boq/boq.module.js';
import { ContractPrismaRepository } from './infrastructure/contract-prisma.repository.js';
import { ContractService } from './application/contract.service.js';
import { ContractsController } from './presentation/contracts.controller.js';

// BoqModule supplies BoqVersioningService for the ADR-029 tie-out (T-4) at contract create.
@Module({
  imports: [TenancyModule, AuditLogsModule, FilesModule, BoqModule],
  providers: [ContractPrismaRepository, ContractService],
  controllers: [ContractsController],
  // ADR-029 V-2 — ContractService exposes `raiseCurrentValueForVariation`, the seam the Variations
  // adopt command (R6) calls to move the current contract value in the adopt transaction. Exported so
  // VariationsModule can reach the Contract through a service (not a cross-module repo).
  exports: [ContractPrismaRepository, ContractService],
})
export class ContractsModule {}
