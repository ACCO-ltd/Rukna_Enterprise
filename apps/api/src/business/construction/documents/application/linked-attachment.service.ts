import { Injectable } from '@nestjs/common';
import {
  AttachmentSourceType,
  IpcAttachmentPurpose,
  type LinkedAttachmentListResponse,
  type LinkedAttachmentResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { LinkedAttachmentRepository } from '../infrastructure/linked-attachment.repository.js';
import { ProjectDocumentRepository } from '../infrastructure/project-document.repository.js';
import type { ListLinkedAttachmentsQueryDto } from '../presentation/dto/project-document.dto.js';

const DEFAULT_PAGE_SIZE = 25;

/**
 * Linked Attachments: every evidence file on this project that some *other* record owns.
 *
 * **This is a read model and nothing else.** There is no attach here, no replace, no delete, and
 * there never should be. A file reaches this list because a DPR, a contract, a guarantee, an IPA
 * or an IPC owns it, and each of those aggregates has its own rules about when its evidence may
 * change — a DPR's photos freeze on approval, a guarantee's instrument freezes when the guarantee
 * is discharged. Offering a Delete button here would route around every one of those rules and
 * leave the parent record pointing at bytes that no longer exist.
 *
 * It answers one question the register cannot: *what evidence exists across this project, and
 * where does it belong?* The register answers a different one — what documents is this project
 * accountable for. Copying attachments into the register would collapse the two and make
 * "controlled document" mean nothing.
 *
 * **Authorization is structural, not additional.** Every query joins through its parent to the
 * project, so a non-member receives no rows at all — the aggregation cannot leak what the parent
 * would refuse. The bytes are then independently gated by `FileAuthorizationService` when someone
 * asks for a download URL, so the index and the content are protected separately.
 */
@Injectable()
export class LinkedAttachmentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: LinkedAttachmentRepository,
    private readonly documents: ProjectDocumentRepository,
  ) {}

  async list(
    identity: RequestIdentity,
    projectId: string,
    query: ListLinkedAttachmentsQueryDto,
  ): Promise<LinkedAttachmentListResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    const [dpr, contracts, guarantees, ipas, ipcs] = await Promise.all([
      this.repo.findDprAttachments(prisma, org, projectId),
      this.repo.findContractAttachments(prisma, org, projectId),
      this.repo.findGuaranteeAttachments(prisma, org, projectId),
      this.repo.findIpaAttachments(prisma, org, projectId),
      this.repo.findIpcAttachments(prisma, org, projectId),
    ]);

    let rows: LinkedAttachmentResponse[] = [
      ...dpr.map((a) => this.fromDpr(a, projectId)),
      ...contracts.map((a) => this.fromContract(a, projectId)),
      ...guarantees.map((a) => this.fromGuarantee(a, projectId)),
      ...ipas.map((a) => this.fromIpa(a, projectId)),
      ...ipcs.map((a) => this.fromIpc(a, projectId)),
    ];

    if (query.sourceType) {
      rows = rows.filter((row) => row.sourceType === query.sourceType);
    }
    if (query.search) {
      const needle = query.search.trim().toLowerCase();
      rows = rows.filter(
        (row) =>
          row.fileName.toLowerCase().includes(needle) ||
          row.sourceReference.toLowerCase().includes(needle),
      );
    }

    // Newest evidence first: this list is read to find something recent far more often than to
    // audit the whole project, and the parent's own screen is where a full history belongs.
    rows.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));

    const total = rows.length;
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);

    // Paged in memory rather than in SQL, and this is a deliberate limit, not an oversight: five
    // heterogeneous parents cannot be ordered and paged as one relation without a database view,
    // and a project's attachment count is in the hundreds. If it ever reaches the thousands this
    // becomes a materialised read model — the shape returned here would not change.
    const names = await this.documents.resolveUserNames(
      prisma,
      org,
      pageRows.map((row) => row.uploadedBy),
    );
    return {
      items: pageRows.map((row) => ({
        ...row,
        uploadedByName: names.get(row.uploadedBy) ?? null,
      })),
      total,
      page,
      pageSize,
    };
  }

  /**
   * `uploadedAt` is the file's own `createdAt`, uniformly across all five sources.
   *
   * `DprAttachment` has no `createdAt` column, and back-filling one would have every historical
   * row claim it was attached at migration time — a fabricated timestamp on an evidence trail.
   * The file's creation is a real, recorded moment for every source, so it is the one used.
   */
  private base(
    file: { id: string; originalName: string; mimeType: string; sizeBytes: number; lifecycle: string; uploadedBy: string; createdAt: Date },
    attachmentId: string,
  ) {
    return {
      attachmentId,
      fileId: file.id,
      fileName: file.originalName,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      lifecycle: file.lifecycle,
      uploadedBy: file.uploadedBy,
      uploadedByName: null,
      uploadedAt: file.createdAt.toISOString(),
    };
  }

  private fromDpr(
    row: Awaited<ReturnType<LinkedAttachmentRepository['findDprAttachments']>>[number],
    projectId: string,
  ): LinkedAttachmentResponse {
    return {
      ...this.base(row.platformFile, row.id),
      sourceType: AttachmentSourceType.DAILY_PROGRESS_REPORT,
      sourceId: row.dpr.id,
      sourceReference: `DPR ${row.dpr.reportDate.toISOString().slice(0, 10)}`,
      context: 'Progress',
      sourceHref: `/projects/${projectId}/progress`,
    };
  }

  private fromContract(
    row: Awaited<ReturnType<LinkedAttachmentRepository['findContractAttachments']>>[number],
    projectId: string,
  ): LinkedAttachmentResponse {
    return {
      ...this.base(row.platformFile, row.id),
      sourceType: AttachmentSourceType.CONTRACT,
      sourceId: row.contract.id,
      sourceReference: row.contract.contractNumber,
      context: 'Commercial',
      sourceHref: `/projects/${projectId}/commercial/main-contract`,
    };
  }

  private fromGuarantee(
    row: Awaited<ReturnType<LinkedAttachmentRepository['findGuaranteeAttachments']>>[number],
    projectId: string,
  ): LinkedAttachmentResponse {
    // Guarantees have their own screen under Commercial. Every href here was checked against a
    // route that exists — a link to a page that 404s is worse than no link at all.
    return {
      ...this.base(row.platformFile, row.id),
      sourceType: AttachmentSourceType.CONTRACT_GUARANTEE,
      sourceId: row.guarantee.id,
      sourceReference: row.guarantee.reference ?? row.guarantee.guaranteeType,
      context: 'Commercial',
      sourceHref: `/projects/${projectId}/commercial/guarantees`,
    };
  }

  private fromIpa(
    row: Awaited<ReturnType<LinkedAttachmentRepository['findIpaAttachments']>>[number],
    projectId: string,
  ): LinkedAttachmentResponse {
    const reference =
      row.application.applicationRef ??
      (row.application.applicationNumber !== null
        ? `IPA-${String(row.application.applicationNumber).padStart(5, '0')}`
        : 'Draft application');
    return {
      ...this.base(row.platformFile, row.id),
      sourceType: AttachmentSourceType.IPA,
      sourceId: row.application.id,
      sourceReference: reference,
      context: 'Commercial',
      sourceHref: `/projects/${projectId}/commercial/applications`,
    };
  }

  private fromIpc(
    row: Awaited<ReturnType<LinkedAttachmentRepository['findIpcAttachments']>>[number],
    projectId: string,
  ): LinkedAttachmentResponse {
    const reference =
      row.certificate.certificateRef ??
      `IPC-${String(row.certificate.certificateNumber).padStart(5, '0')}`;
    return {
      ...this.base(row.platformFile, row.id),
      sourceType: AttachmentSourceType.IPC,
      sourceId: row.certificate.id,
      sourceReference: reference,
      // The issued certificate and its working support are different kinds of evidence and are
      // labelled as such, rather than both reading as "IPC".
      context:
        row.purpose === IpcAttachmentPurpose.ISSUED_CERTIFICATE
          ? 'Commercial · Issued certificate'
          : 'Commercial',
      sourceHref: `/projects/${projectId}/commercial/applications`,
    };
  }
}
