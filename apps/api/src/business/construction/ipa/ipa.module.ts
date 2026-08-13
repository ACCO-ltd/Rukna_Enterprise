import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { IpaPrismaRepository } from './infrastructure/ipa-prisma.repository.js';
import { IpaService } from './application/ipa.service.js';
import { IpaController } from './presentation/ipa.controller.js';

@Module({
  imports: [TenancyModule, WorkflowsModule, AuditLogsModule],
  providers: [IpaPrismaRepository, IpaService],
  controllers: [IpaController],
  exports: [IpaPrismaRepository],
})
export class IpaModule {}
