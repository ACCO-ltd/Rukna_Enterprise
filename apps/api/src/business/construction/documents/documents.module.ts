import { Module } from '@nestjs/common';

import { ProjectDocumentController } from './presentation/project-document.controller.js';
import { ProjectDocumentService } from './application/project-document.service.js';
import { LinkedAttachmentService } from './application/linked-attachment.service.js';
import { ProjectDocumentRepository } from './infrastructure/project-document.repository.js';
import { LinkedAttachmentRepository } from './infrastructure/linked-attachment.repository.js';
import { FilesModule } from '../../../platform/files/files.module.js';
import { AuditLogsModule } from '../../../platform/audit-logs/audit-logs.module.js';

/**
 * Project document control (Phase 7A).
 *
 * Two read surfaces behind one route prefix, and they are deliberately different things:
 *
 *   the REGISTER            documents this project is accountable for — its own aggregate
 *   LINKED ATTACHMENTS      evidence other aggregates own — a read model over five parents
 *
 * `FilesModule` is imported for the file lifecycle (bind on register, freeze on issue, discard on
 * discard); `AuditLogsModule` for the transactional outbox, so a document event and the state
 * change that caused it commit together or not at all. TenancyModule and ProjectAccessModule are
 * @Global.
 */
@Module({
  imports: [FilesModule, AuditLogsModule],
  controllers: [ProjectDocumentController],
  providers: [
    ProjectDocumentService,
    LinkedAttachmentService,
    ProjectDocumentRepository,
    LinkedAttachmentRepository,
  ],
  exports: [ProjectDocumentService],
})
export class DocumentsModule {}
