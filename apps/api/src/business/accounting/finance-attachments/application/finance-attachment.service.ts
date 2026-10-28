import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { FinanceAttachment, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { FinanceAttachmentRepository } from '../infrastructure/finance-attachment.repository.js';
import {
  canChangeAttachments,
  canReadAttachments,
  isInTheBooks,
  type FinanceAttachmentKind,
} from '../../../../platform/files/domain/finance-attachment-policy.js';

/**
 * Step 4 — evidence on finance documents: the supplier's invoice scan on a bill, the bank advice on
 * a payment, the signed delivery note behind an invoice, the support for a manual journal.
 *
 * The mechanics follow RecordAttachmentService (verify the upload, bind, freeze); the rules do not:
 * finance documents are gated by organization permission, not project membership, and they freeze
 * when they reach the books. A file added to a posted document is frozen on the way in and flagged
 * `isPostSubmission`, so the record shows which evidence existed when the entry was made.
 *
 * Files attached before posting are not re-stamped IMMUTABLE when the document posts: this service
 * is the only route by which a bound file leaves (`/files/:id` refuses a bound file), and it reads
 * the document's posting state on every removal. Pushing a freeze from five posting services would
 * add five cross-module calls to guard a door that is already shut.
 */
@Injectable()
export class FinanceAttachmentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly files: PlatformFileService,
    private readonly repo: FinanceAttachmentRepository,
  ) {}

  async list(identity: RequestIdentity, kind: FinanceAttachmentKind, ownerId: string): Promise<FinanceAttachment[]> {
    if (!canReadAttachments(identity.permissions, kind)) throw this.denied();
    const status = await this.requireParent(identity, kind, ownerId);
    const rows = await this.repo.list(this.tenancy.getClient(), kind, ownerId);
    return rows.map((row) => toResponse(row, isInTheBooks(status)));
  }

  async attach(
    identity: RequestIdentity,
    kind: FinanceAttachmentKind,
    ownerId: string,
    platformFileId: string,
  ): Promise<FinanceAttachment> {
    if (!canChangeAttachments(identity.permissions, kind)) throw this.denied();
    const status = await this.requireParent(identity, kind, ownerId);
    const prisma = this.tenancy.getClient();

    const file = await this.repo.findFileStatus(prisma, identity.activeOrganizationId, platformFileId);
    if (!file) throw new NotFoundException({ errorCode: 'FILE_NOT_FOUND', message: `File ${platformFileId} not found` });
    if (file.status !== 'READY') {
      throw new BadRequestException({ errorCode: 'FILE_NOT_READY', message: 'The file must finish uploading before it can be attached.' });
    }
    if (file.lifecycle !== 'TEMPORARY') {
      throw new BadRequestException({ errorCode: 'FILE_ALREADY_ATTACHED', message: 'That file is already attached to a record.' });
    }
    if (file.uploadedBy !== identity.userId) {
      throw new ForbiddenException({ errorCode: 'FILE_NOT_YOURS', message: 'You can only attach a file that you uploaded.' });
    }

    const posted = isInTheBooks(status);
    const row = await this.repo.create(prisma, kind, ownerId, {
      platformFileId,
      createdBy: identity.userId,
      isPostSubmission: posted,
    });
    await this.files.bind(platformFileId, `${kind.toLowerCase()} evidence ${row.id}`);
    if (posted) await this.files.markImmutable(platformFileId, `evidence on posted ${kind.toLowerCase()} ${ownerId}`);
    return toResponse(row, posted);
  }

  async remove(identity: RequestIdentity, kind: FinanceAttachmentKind, ownerId: string, attachmentId: string) {
    if (!canChangeAttachments(identity.permissions, kind)) throw this.denied();
    const status = await this.requireParent(identity, kind, ownerId);
    const prisma = this.tenancy.getClient();

    const attachment = await this.repo.findOwned(prisma, kind, ownerId, attachmentId);
    if (!attachment) throw new NotFoundException({ errorCode: 'ATTACHMENT_NOT_FOUND', message: `Attachment ${attachmentId} not found` });
    if (isInTheBooks(status) || attachment.platformFile.lifecycle === 'IMMUTABLE') {
      throw new ForbiddenException({
        errorCode: 'ATTACHMENT_FROZEN',
        message: 'This document is posted, so its evidence is part of the record and cannot be removed.',
      });
    }
    await this.repo.delete(prisma, kind, attachmentId);
    await this.files.discardIfUnreferenced(attachment.platformFileId);
    return { id: attachmentId, deleted: true };
  }

  private async requireParent(identity: RequestIdentity, kind: FinanceAttachmentKind, ownerId: string): Promise<string> {
    const status = await this.repo.findParentStatus(this.tenancy.getClient(), identity.activeOrganizationId, kind, ownerId);
    if (status === null) throw new NotFoundException({ errorCode: 'DOCUMENT_NOT_FOUND', message: `${kind} ${ownerId} not found` });
    return status;
  }

  private denied() {
    return new ForbiddenException({ errorCode: 'FORBIDDEN', message: 'You do not have access to this document’s attachments.' });
  }
}

function toResponse(
  row: {
    id: string;
    isPostSubmission: boolean;
    createdBy: string;
    createdAt: Date;
    platformFile: { id: string; originalName: string; mimeType: string; sizeBytes: number };
  },
  posted: boolean,
): FinanceAttachment {
  return {
    id: row.id,
    fileId: row.platformFile.id,
    fileName: row.platformFile.originalName,
    mimeType: row.platformFile.mimeType,
    sizeBytes: row.platformFile.sizeBytes,
    addedAfterPosting: row.isPostSubmission,
    locked: posted,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}
