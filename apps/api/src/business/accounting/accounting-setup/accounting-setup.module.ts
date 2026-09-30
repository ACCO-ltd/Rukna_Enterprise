import { Module } from '@nestjs/common';

import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { AccountingCoreModule } from '../accounting-core/accounting-core.module.js';

import { AccountingSetupRepository } from './infrastructure/accounting-setup.repository.js';
import { AccountingSetupService } from './application/accounting-setup.service.js';
import { AccountingSetupController } from './presentation/accounting-setup.controller.js';

/** ADR-040 — one-step accounting setup from a versioned template. */
@Module({
  imports: [TenancyModule, AccountingCoreModule],
  controllers: [AccountingSetupController],
  providers: [AccountingSetupRepository, AccountingSetupService],
})
export class AccountingSetupModule {}
