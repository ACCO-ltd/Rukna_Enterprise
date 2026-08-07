import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { BillMatchRepository } from './infrastructure/bill-match.repository.js';
import { BillMatchingService } from './application/bill-matching.service.js';
import { BillMatchingController } from './presentation/bill-matching.controller.js';

@Module({
  imports: [TenancyModule],
  controllers: [BillMatchingController],
  providers: [BillMatchRepository, BillMatchingService],
  exports: [BillMatchingService],
})
export class BillMatchingModule {}
