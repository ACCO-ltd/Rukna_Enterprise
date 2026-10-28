import { Module } from '@nestjs/common';

import { AgingReportController, FinanceHomeController } from './presentation/finance-home.controller.js';
import { AgingReportService } from './application/aging-report.service.js';
import { FinanceHomeService } from './application/finance-home.service.js';
import { FinanceHomeRepository } from './infrastructure/finance-home.repository.js';

// Step 4 (ADR-047 §4) Finance Home, and the Step 6 aging reports. TenancyModule is @Global.
@Module({
  controllers: [FinanceHomeController, AgingReportController],
  providers: [FinanceHomeService, AgingReportService, FinanceHomeRepository],
})
export class FinanceHomeModule {}
