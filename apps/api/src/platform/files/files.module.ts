import { Module } from '@nestjs/common';

import { FilesController } from './presentation/files.controller.js';
import { PlatformFileService } from './application/platform-file.service.js';
import { PlatformFileRepository } from './infrastructure/platform-file.repository.js';
import { MinioFileStorageAdapter } from './infrastructure/minio-file-storage.adapter.js';
import { FILE_STORAGE_PORT } from './application/ports/file-storage.port.js';

// ADR-014: shared PlatformFile module. Domain depends on FILE_STORAGE_PORT; the MinIO adapter is
// the only thing bound to the S3 SDK, so a managed store is a one-line provider swap.
@Module({
  controllers: [FilesController],
  providers: [
    PlatformFileService,
    PlatformFileRepository,
    { provide: FILE_STORAGE_PORT, useClass: MinioFileStorageAdapter },
  ],
  exports: [PlatformFileService],
})
export class FilesModule {}
