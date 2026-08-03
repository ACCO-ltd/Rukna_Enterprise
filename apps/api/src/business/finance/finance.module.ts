import { Module } from '@nestjs/common';
import { TenancyModule } from '../../platform/tenancy/tenancy.module.js';
import { FinancePrismaRepository } from './infrastructure/finance-prisma.repository.js';
import { FinanceService } from './application/finance.service.js';
import { FinanceController } from './presentation/finance.controller.js';

@Module({
  imports: [TenancyModule],
  providers: [FinancePrismaRepository, FinanceService],
  controllers: [FinanceController],
})
export class FinanceModule {}
