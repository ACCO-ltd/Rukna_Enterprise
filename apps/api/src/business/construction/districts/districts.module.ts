import { Module } from '@nestjs/common';

import { DistrictController } from './presentation/district.controller.js';
import { DistrictService } from './application/district.service.js';
import { DistrictRepository } from './infrastructure/district-prisma.repository.js';

// TenancyModule is @Global.
@Module({
  controllers: [DistrictController],
  providers: [DistrictService, DistrictRepository],
  exports: [DistrictService],
})
export class DistrictsModule {}
