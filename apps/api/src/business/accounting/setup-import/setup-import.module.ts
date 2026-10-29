import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { ClientsModule } from '../../../platform/clients/clients.module.js';
import { AccountsPayableModule } from '../accounts-payable/accounts-payable.module.js';
import { SetupImportController } from './presentation/setup-import.controller.js';
import { SetupImportService } from './application/setup-import.service.js';
import { SetupImportRepository } from './infrastructure/setup-import.repository.js';

// Step 5 — suppliers and clients from a spreadsheet. TenancyModule is @Global.
@Module({
  imports: [AuditLogsModule, ClientsModule, AccountsPayableModule],
  controllers: [SetupImportController],
  providers: [SetupImportService, SetupImportRepository],
})
export class SetupImportModule {}
