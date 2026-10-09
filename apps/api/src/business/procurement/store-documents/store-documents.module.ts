import { Module } from '@nestjs/common';

import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';
import { QuotationsModule } from '../quotations/quotations.module.js';
import { StoreDocumentRepository } from './infrastructure/store-document.repository.js';
import { StoreDocumentService } from './application/store-document.service.js';
import { StoreDocumentController } from './presentation/store-document.controller.js';

/**
 * ADR-045 §2 — the store's receipt / invoice photographed by the buyer. Depends on quotations
 * (the award, its collectors, the payment notifier); Accounts Payable records documents into bills.
 */
@Module({
  imports: [AuditLogsModule, QuotationsModule],
  controllers: [StoreDocumentController],
  providers: [StoreDocumentRepository, StoreDocumentService],
  exports: [StoreDocumentService, StoreDocumentRepository],
})
export class StoreDocumentsModule {}
