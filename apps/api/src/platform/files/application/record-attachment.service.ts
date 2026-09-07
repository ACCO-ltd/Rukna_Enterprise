import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { IpcAttachmentPurpose } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../project-access/project-access.service.js';
import { PlatformFileService } from './platform-file.service.js';
import { RecordAttachmentRepository } from '../infrastructure/record-attachment.repository.js';

/**
 * Evidence on a business record that is not a controlled document.
 *
 * Four owners share this service — contract, guarantee, IPA, IPC — because the *mechanics* are
 * identical (verify the file, check the parent's project, bind, freeze when the parent finalises)
 * while the *rules* are not. The rules live in {@link FINALISED_BY}, one entry per owner, derived
 * from each parent's actual state machine rather than from what a document register would like it
 * to be. That is the split the Phase 7 spec asks for: a shared policy over separate aggregates,
 * never one generic table with a nullable scope.
 *
 * **What the freeze points actually are, and why they are not uniform:**
 *
 * | Owner | Frozen when | Because |
 * |---|---|---|
 * | Contract | status reaches ACTIVE (executed) | Execution is the real signature event |
 * | Guarantee | status leaves ACTIVE | A guarantee is created ACTIVE — there is no draft period, so the *end* of its life is the only real transition |
 * | IPA | status reaches SUBMITTED | Submission is what puts the evidence in front of the client |
 * | IPC (issued certificate) | on attach | The certificate is already effective when `issue()` creates it; there is no later event to wait for |
 * | IPC (supporting) | when the certificate is superseded | Its content becomes history at that point |
 *
 * The guarantee and issued-certificate rows are the two that look odd, and both are odd because
 * the domain is, not because the rule was chosen carelessly. Inventing a "guarantee accepted"
 * transition to make the table tidy would be a fabricated control — the same defect the accounting
 * review removed from journals.
 */

export type AttachmentOwnerKind = 'CONTRACT' | 'GUARANTEE' | 'IPA' | 'IPC';

export interface AttachEvidenceDto {
  platformFileId: string;
  /** IPC only: SUPPORTING (default) or ISSUED_CERTIFICATE. Ignored elsewhere. */
  purpose?: IpcAttachmentPurpose;
}

@Injectable()
export class RecordAttachmentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly files: PlatformFileService,
    private readonly repo: RecordAttachmentRepository,
  ) {}

  async list(identity: RequestIdentity, kind: AttachmentOwnerKind, ownerId: string) {
    await this.assertParentAccess(identity, kind, ownerId);
    return this.repo.list(this.tenancy.getClient(), kind, ownerId);
  }

  /**
   * Attach a confirmed upload as evidence.
   *
   * If the parent has *already* finalised, the file is frozen on the way in rather than left
   * BOUND: a certificate that is issued does not become issued again later, so waiting for a
   * transition that has already happened would leave its evidence permanently deletable.
   */
  async attach(
    identity: RequestIdentity,
    kind: AttachmentOwnerKind,
    ownerId: string,
    dto: AttachEvidenceDto,
  ) {
    const parent = await this.assertParentAccess(identity, kind, ownerId);
    const prisma = this.tenancy.getClient();

    const file = await this.repo.findFileStatus(
      prisma,
      identity.activeOrganizationId,
      dto.platformFileId,
    );
    if (!file) throw new NotFoundException(`File ${dto.platformFileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The file must be fully uploaded before it can be attached.');
    }
    if (file.lifecycle !== 'TEMPORARY') {
      throw new BadRequestException('That file is already attached to a record.');
    }
    if (file.uploadedBy !== identity.userId) {
      throw new ForbiddenException('You can only attach a file that you uploaded.');
    }

    const attachment = await this.repo.create(prisma, kind, ownerId, {
      platformFileId: dto.platformFileId,
      createdBy: identity.userId,
      purpose: dto.purpose,
    });

    await this.files.bind(dto.platformFileId, `${kind.toLowerCase()} evidence ${attachment.id}`);

    if (this.isFinalised(kind, parent, dto.purpose)) {
      await this.files.markImmutable(
        dto.platformFileId,
        `evidence on finalised ${kind.toLowerCase()} ${ownerId}`,
      );
    }
    return attachment;
  }

  /**
   * Detach evidence from a record that has not finalised.
   *
   * Refused once the file is IMMUTABLE, and refused for anyone but the parent's own workflow —
   * this is the *only* route by which a bound attachment leaves the system, which is why the check
   * lives here rather than on the file API. `/files/:id` refuses a bound file precisely so this
   * path is the single one.
   */
  async remove(
    identity: RequestIdentity,
    kind: AttachmentOwnerKind,
    ownerId: string,
    attachmentId: string,
  ) {
    await this.assertParentAccess(identity, kind, ownerId);
    const prisma = this.tenancy.getClient();

    const attachment = await this.repo.findOwned(prisma, kind, ownerId, attachmentId);
    if (!attachment) throw new NotFoundException(`Attachment ${attachmentId} not found`);
    if (attachment.platformFile.lifecycle === 'IMMUTABLE') {
      throw new ForbiddenException(
        'This file is evidence on a finalised record and cannot be removed. Attach a ' +
          'replacement instead.',
      );
    }

    await this.repo.delete(prisma, kind, attachmentId);
    await this.files.discardIfUnreferenced(attachment.platformFileId);
    return { id: attachmentId, deleted: true };
  }

  /**
   * Freeze every attachment on a record that has just finalised.
   *
   * Called by the parent module from inside its own transition — `contract.execute`,
   * `ipa.submit`, a guarantee leaving ACTIVE, an IPC being superseded. Deliberately a push from
   * the parent rather than a pull from here: only the parent knows what its own finalisation
   * means, and a files module that inspected foreign statuses would be guessing.
   */
  async freezeFor(kind: AttachmentOwnerKind, ownerId: string, reason: string): Promise<number> {
    const fileIds = await this.repo.findFileIds(this.tenancy.getClient(), kind, ownerId);
    return this.files.markManyImmutable(fileIds, reason);
  }

  /** Project membership through whichever path this parent reaches its project by. */
  private async assertParentAccess(
    identity: RequestIdentity,
    kind: AttachmentOwnerKind,
    ownerId: string,
  ) {
    const prisma = this.tenancy.getClient();
    const parent = await this.repo.findParent(prisma, identity.activeOrganizationId, kind, ownerId);
    if (!parent) throw new NotFoundException(`${kind} ${ownerId} not found`);
    await this.projectAccess.assertMember(identity, parent.projectId);
    return parent;
  }

  /**
   * Has this parent already reached the state that makes its evidence part of the record?
   *
   * One place, so a new owner cannot be added without answering the question.
   */
  private isFinalised(
    kind: AttachmentOwnerKind,
    parent: { status: string; isEffective?: boolean },
    purpose?: IpcAttachmentPurpose,
  ): boolean {
    switch (kind) {
      // Executed. Everything after ACTIVE is also past execution.
      case 'CONTRACT':
        return ['ACTIVE', 'FINAL_ACCOUNT_PENDING', 'CLOSED', 'TERMINATED'].includes(parent.status);
      // A guarantee is created ACTIVE, so ACTIVE is not a finalisation — leaving it is.
      case 'GUARANTEE':
        return parent.status !== 'ACTIVE';
      case 'IPA':
        return parent.status === 'SUBMITTED';
      // The certificate is already effective when it exists. Only the issued certificate itself
      // freezes on arrival; working support stays replaceable until the certificate is superseded.
      case 'IPC':
        return purpose === 'ISSUED_CERTIFICATE' && parent.isEffective === true;
    }
  }
}
