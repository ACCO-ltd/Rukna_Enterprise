import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';
import { BankStatementController } from './presentation/bank-statement.controller.js';
import { BankReconciliationService } from './application/bank-reconciliation.service.js';
import { BankStatementRepository } from './infrastructure/bank-statement.repository.js';

// Step 6 — bank reconciliation. Posts charges through the accounting posting port. TenancyModule is @Global.
@Module({
  imports: [AuditLogsModule, AccountingCoreModule],
  controllers: [BankStatementController],
  providers: [BankReconciliationService, BankStatementRepository],
})
export class BankReconciliationModule {}
