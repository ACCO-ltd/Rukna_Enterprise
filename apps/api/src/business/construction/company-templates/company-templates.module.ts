import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { CompanyTemplatesController } from './presentation/company-templates.controller.js';
import { CompanyTemplatesService } from './application/company-templates.service.js';
import { CompanyTemplatesRepository } from './infrastructure/company-templates.repository.js';

// Step 1b (ADR-047). TenancyModule is @Global; AuditLogsModule provides the audit outbox.
@Module({
  imports: [AuditLogsModule],
  controllers: [CompanyTemplatesController],
  providers: [CompanyTemplatesService, CompanyTemplatesRepository],
  exports: [CompanyTemplatesService],
})
export class CompanyTemplatesModule {}
