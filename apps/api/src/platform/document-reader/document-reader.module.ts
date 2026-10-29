import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuditLogsModule } from '../audit-logs/audit-logs.module.js';
import { FilesModule } from '../files/files.module.js';
import { DocumentReaderController } from './presentation/document-reader.controller.js';
import { DocumentReaderService } from './application/document-reader.service.js';
import { DOCUMENT_READER_PROVIDER } from './application/reader-provider.port.js';
import { DocumentReaderRepository } from './infrastructure/document-reader.repository.js';
import { NoReader, OpenRouterReader } from './infrastructure/openrouter.reader.js';

/**
 * Step 7 — the photo reader. `DOCUMENT_READER_PROVIDER` picks the provider for the whole server:
 * `openrouter` (the default, owner decision 2026-10-28) or `none`. TenancyModule is @Global.
 */
@Module({
  imports: [AuditLogsModule, FilesModule],
  controllers: [DocumentReaderController],
  providers: [
    DocumentReaderService,
    DocumentReaderRepository,
    {
      provide: DOCUMENT_READER_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        (config.get<string>('DOCUMENT_READER_PROVIDER')?.trim().toLowerCase() || 'openrouter') === 'none'
          ? new NoReader()
          : new OpenRouterReader(config),
    },
  ],
})
export class DocumentReaderModule {}
