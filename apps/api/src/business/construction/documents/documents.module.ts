import { Module } from '@nestjs/common';

import { ProjectDocumentController } from './presentation/project-document.controller.js';
import { ProjectDocumentService } from './application/project-document.service.js';
import { ProjectDocumentRepository } from './infrastructure/project-document.repository.js';

// TenancyModule and ProjectAccessModule are @Global, so no imports are needed.
@Module({
  controllers: [ProjectDocumentController],
  providers: [ProjectDocumentService, ProjectDocumentRepository],
  exports: [ProjectDocumentService],
})
export class DocumentsModule {}
