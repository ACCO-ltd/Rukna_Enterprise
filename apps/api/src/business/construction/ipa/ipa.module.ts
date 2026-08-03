import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { IpaPrismaRepository } from './infrastructure/ipa-prisma.repository.js';
import { IpaService } from './application/ipa.service.js';
import { IpaController } from './presentation/ipa.controller.js';

@Module({
  imports: [TenancyModule, WorkflowsModule],
  providers: [IpaPrismaRepository, IpaService],
  controllers: [IpaController],
  exports: [IpaPrismaRepository],
})
export class IpaModule {}
