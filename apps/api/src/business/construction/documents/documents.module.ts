import { Module } from '@nestjs/common';

import { ProjectDocumentController } from './presentation/project-document.controller.js';
import { ProjectDocumentService } from './application/project-document.service.js';
import { ProjectDocumentRepository } from './infrastructure/project-document.repository.js';
import { FilesModule } from '../../../platform/files/files.module.js';

// TenancyModule and ProjectAccessModule are @Global. FilesModule is imported for the file
// lifecycle: attaching a document binds its file, and detaching one discards it.
@Module({
  imports: [FilesModule],
  controllers: [ProjectDocumentController],
  providers: [ProjectDocumentService, ProjectDocumentRepository],
  exports: [ProjectDocumentService],
})
export class DocumentsModule {}
