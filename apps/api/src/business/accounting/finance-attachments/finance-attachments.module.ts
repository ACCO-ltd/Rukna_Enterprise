import { Module } from '@nestjs/common';

import { FilesModule } from '../../../platform/files/files.module.js';
import { FinanceAttachmentController } from './presentation/finance-attachment.controller.js';
import { FinanceAttachmentService } from './application/finance-attachment.service.js';
import { FinanceAttachmentRepository } from './infrastructure/finance-attachment.repository.js';

// Step 4 — evidence on finance documents. TenancyModule is @Global.
@Module({
  imports: [FilesModule],
  controllers: [FinanceAttachmentController],
  providers: [FinanceAttachmentService, FinanceAttachmentRepository],
})
export class FinanceAttachmentsModule {}
