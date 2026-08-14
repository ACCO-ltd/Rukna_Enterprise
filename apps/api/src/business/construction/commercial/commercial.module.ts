import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { CommercialPrismaRepository } from './infrastructure/commercial-prisma.repository.js';
import { CommercialService } from './application/commercial.service.js';
import { CommercialController } from './presentation/commercial.controller.js';

/**
 * Project-scoped Commercial read models (ADR-017, Gate B). Read-only aggregation across
 * contract / IPA / IPC / AR — construction → accounting, allowed by ARCH-BOUNDARY-001.
 */
@Module({
  imports: [TenancyModule],
  providers: [CommercialPrismaRepository, CommercialService],
  controllers: [CommercialController],
  exports: [CommercialService],
})
export class CommercialModule {}
