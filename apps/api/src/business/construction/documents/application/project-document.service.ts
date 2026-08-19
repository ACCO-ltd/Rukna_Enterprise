import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { DocumentCategory } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProjectDocumentRepository } from '../infrastructure/project-document.repository.js';

export interface AttachDocumentDto {
  platformFileId: string;
  category: DocumentCategory;
  title: string;
}

/**
 * Documents tab: standalone project documents (permits, drawings, licences...) that link an
 * already-uploaded PlatformFile (ADR-014) to a project. The two-step upload happens through the
 * Files API first (POST /files -> upload -> confirm); this only attaches the READY file.
 */
@Injectable()
export class ProjectDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProjectDocumentRepository,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  async attach(identity: RequestIdentity, projectId: string, dto: AttachDocumentDto) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();

    const file = await this.repo.findFileStatus(prisma, identity.activeOrganizationId, dto.platformFileId);
    if (!file) throw new NotFoundException(`File ${dto.platformFileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The file must be fully uploaded (READY) before it can be attached.');
    }

    return this.repo.create(prisma, {
      organizationId: identity.activeOrganizationId,
      projectId,
      platformFileId: dto.platformFileId,
      category: dto.category,
      title: dto.title,
      uploadedBy: identity.userId,
    });
  }

  async list(identity: RequestIdentity, projectId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    return this.repo.findByProject(this.tenancy.getClient(), identity.activeOrganizationId, projectId);
  }

  /** Detach a project document. The underlying PlatformFile is governed by its own immutability. */
  async remove(identity: RequestIdentity, projectId: string, id: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const doc = await this.repo.findOwned(prisma, identity.activeOrganizationId, projectId, id);
    if (!doc) throw new NotFoundException(`Document ${id} not found`);
    return this.repo.delete(prisma, id);
  }
}
