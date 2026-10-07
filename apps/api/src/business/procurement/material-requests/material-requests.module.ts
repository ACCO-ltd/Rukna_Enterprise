import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { CatalogueModule } from '../catalogue/catalogue.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { WorkflowsModule } from '../../../platform/workflows/workflows.module.js';
import { QuotationsModule } from '../quotations/quotations.module.js';
import { MaterialRequestRepository } from './infrastructure/material-request.repository.js';
import { MaterialRequestService } from './application/material-request.service.js';
import { MaterialRequestController } from './presentation/material-request.controller.js';

@Module({
  // ADR-044 — QuotationsModule for the MR-cancel cascade and the MR detail's quotation summary.
  imports: [TenancyModule, CatalogueModule, AuditLogsModule, WorkflowsModule, QuotationsModule],
  controllers: [MaterialRequestController],
  providers: [MaterialRequestRepository, MaterialRequestService],
  exports: [MaterialRequestService, MaterialRequestRepository],
})
export class MaterialRequestsModule {}
