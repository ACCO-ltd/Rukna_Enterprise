import { Module } from '@nestjs/common';
import { TenancyModule } from '../../../platform/tenancy/tenancy.module.js';
import { CommitmentLedgerRepository } from './infrastructure/commitment-ledger.repository.js';
import { CommitmentLedgerService } from './application/commitment-ledger.service.js';
import { CommitmentLedgerController } from './presentation/commitment-ledger.controller.js';

@Module({
  imports: [TenancyModule],
  controllers: [CommitmentLedgerController],
  providers: [CommitmentLedgerRepository, CommitmentLedgerService],
  exports: [CommitmentLedgerRepository, CommitmentLedgerService],
})
export class CommitmentLedgerModule {}
