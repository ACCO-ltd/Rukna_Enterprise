import { Module } from '@nestjs/common';

import { FinanceHomeController } from './presentation/finance-home.controller.js';
import { FinanceHomeService } from './application/finance-home.service.js';
import { FinanceHomeRepository } from './infrastructure/finance-home.repository.js';

// Step 4 (ADR-047 §4). TenancyModule is @Global.
@Module({
  controllers: [FinanceHomeController],
  providers: [FinanceHomeService, FinanceHomeRepository],
})
export class FinanceHomeModule {}
