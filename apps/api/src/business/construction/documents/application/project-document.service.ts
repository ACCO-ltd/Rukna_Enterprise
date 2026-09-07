import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentCategory } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { ProjectDocumentRepository } from '../infrastructure/project-document.repository.js';

export interface AttachDocumentDto {
  platformFileId: string;
  category: DocumentCategory;
  title: string;
}

/**
 * Documents tab: standalone project documents (permits, drawings, licences…) that link an
 * already-uploaded PlatformFile (ADR-014) to a project. The two-step upload happens through the
 * Files API first (POST /files → upload → confirm); this only attaches the READY file.
 *
 * **The register owns its files' lifecycle.** Attaching binds the file, which takes it out of
 * reach of the abandoned-upload sweep and out of reach of `DELETE /files/:id`; detaching discards
 * it. Before this, removing a document deleted only its own row and left the file and the bytes
 * behind for good (Phase 7 audit P1-2).
 *
 * The register has **no finalisation event yet** — a `ProjectDocument` has no status, no issue and
 * no revision — so its files stay BOUND rather than becoming IMMUTABLE. That is the honest
 * position: freezing them would assert a control the model cannot yet express. It changes when
 * the document register's own lifecycle is designed (Phase 7 Step H).
 */
@Injectable()
export class ProjectDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProjectDocumentRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly files: PlatformFileService,
  ) {}

  async attach(identity: RequestIdentity, projectId: string, dto: AttachDocumentDto) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const file = await this.repo.findFileStatus(prisma, identity.activeOrganizationId, dto.platformFileId);
    if (!file) throw new NotFoundException(`File ${dto.platformFileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The file must be fully uploaded (READY) before it can be attached.');
    }
    // A file another record already owns is not free to be claimed by this one; a caller who
    // wants the same bytes on two records uploads them twice, and each record's copy then has
    // its own lifecycle. Silently sharing would make one record's deletion break the other.
    if (file.lifecycle !== 'TEMPORARY') {
      throw new BadRequestException('That file is already attached to a record.');
    }
    if (file.uploadedBy !== identity.userId) {
      throw new ForbiddenException('You can only attach a file that you uploaded.');
    }

    const document = await this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      projectId,
      platformFileId: dto.platformFileId,
      category: dto.category,
      title: dto.title,
      uploadedBy: identity.userId,
    });

    await this.files.bind(dto.platformFileId, `project document ${document.id}`);
    return document;
  }

  async list(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findByProject(this.tenancy.getClient(), identity.activeOrganizationId, projectId);
  }

  /**
   * Detach a project document and discard its file.
   *
   * This is the *only* way a bound file leaves the system, which is why the immutability check
   * lives here as well as in the file authorization service: a register that could delete its own
   * row while the file API refused the file would leave orphaned bytes and a missing record.
   */
  async remove(identity: RequestIdentity, projectId: string, id: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const doc = await this.repo.findOwned(prisma, identity.activeOrganizationId, projectId, id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);

    if (doc.platformFile.lifecycle === 'IMMUTABLE') {
      throw new ForbiddenException(
        'This document is part of a finalised record and cannot be removed. Attach a replacement instead.',
      );
    }

    const removed = await this.repo.delete(prisma, id);
    await this.files.discardIfUnreferenced(doc.platformFileId);
    return removed;
  }
}
