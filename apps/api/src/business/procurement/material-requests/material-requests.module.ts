import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { MaterialRequestRepository } from './infrastructure/material-request.repository.js';
import { MaterialRequestService } from './application/material-request.service.js';
import { MaterialRequestController } from './presentation/material-request.controller.js';

@Module({
  imports: [TenancyModule, CatalogueModule],
  controllers: [MaterialRequestController],
  providers: [MaterialRequestRepository, MaterialRequestService],
  exports: [MaterialRequestService, MaterialRequestRepository],
})
export class MaterialRequestsModule {}
