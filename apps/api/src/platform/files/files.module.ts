import { Module } from '@nestjs/common';

import { FilesController } from './presentation/files.controller.js';
import { PlatformFileService } from './application/platform-file.service.js';
import { FileAuthorizationService } from './application/file-authorization.service.js';
import { RecordAttachmentService } from './application/record-attachment.service.js';
import { RecordAttachmentRepository } from './infrastructure/record-attachment.repository.js';
import { PlatformFileRepository } from './infrastructure/platform-file.repository.js';
import { MinioFileStorageAdapter } from './infrastructure/minio-file-storage.adapter.js';
import { FILE_STORAGE_PORT } from './application/ports/file-storage.port.js';

// ADR-014: shared PlatformFile module. Domain depends on FILE_STORAGE_PORT; the MinIO adapter is
// the only thing bound to the S3 SDK, so a managed store is a one-line provider swap.
//
// TenancyModule and ProjectAccessModule are @Global, so neither is imported.
// FileAuthorizationService is exported alongside the service because a file's permissions come
// from the record that owns it: modules that attach files resolve ownership through here rather
// than each inventing their own rule.
@Module({
  controllers: [FilesController],
  providers: [
    PlatformFileService,
    FileAuthorizationService,
    RecordAttachmentService,
    PlatformFileRepository,
    RecordAttachmentRepository,
    { provide: FILE_STORAGE_PORT, useClass: MinioFileStorageAdapter },
  ],
  exports: [PlatformFileService, FileAuthorizationService, RecordAttachmentService],
})
export class FilesModule {}
