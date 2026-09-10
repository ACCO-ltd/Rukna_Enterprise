import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { VariationsModule } from '../variations/variations.module.js';
import { BoqModule } from '../boq/boq.module.js';
import { CommercialPrismaRepository } from './infrastructure/commercial-prisma.repository.js';
import { CommercialService } from './application/commercial.service.js';
import { CommercialController } from './presentation/commercial.controller.js';

/**
 * Project-scoped Commercial read models (ADR-017, Gate B). Read-only aggregation across
 * contract / IPA / IPC / AR — construction → accounting, allowed by ARCH-BOUNDARY-001. Imports
 * VariationsModule to derive the ADR-026 contract-value figures from the VariationOrder set, and
 * BoqModule for the ADR-029 T-5 separate-charge total (via BoqVersioningService's read port) that
 * feeds total client revenue.
 */
@Module({
  imports: [TenancyModule, VariationsModule, BoqModule],
  providers: [CommercialPrismaRepository, CommercialService],
  controllers: [CommercialController],
  exports: [CommercialService],
})
export class CommercialModule {}
