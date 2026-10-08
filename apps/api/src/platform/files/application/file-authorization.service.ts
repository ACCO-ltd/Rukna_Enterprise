import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../project-access/project-access.service.js';

/**
 * Who is allowed to touch a file's bytes.
 *
 * The defect this exists to close (Phase 7 audit P0-1): `FilesController` declared no permission,
 * `PermissionsGuard` returns true when none is declared, and the repository scopes by
 * `organizationId` alone — so any signed-in user could download or delete any file in the
 * organisation, including evidence on a project they were never added to. The *register*
 * (`/projects/:id/documents`) checked membership correctly; the payload behind it did not. Access
 * control sat on the index, not on the content.
 *
 * **A file has no permissions of its own.** It inherits them from whatever business record owns
 * it, which is why this resolves the owning aggregate first and then asks that aggregate's own
 * access rule. Adding a new attachment kind means adding a case here — one place, not one per
 * controller, so a module cannot ship an upload path that forgets to authorize the download.
 *
 * An unowned file is not public: it is private to whoever uploaded it. That is the only period in
 * a file's life when no business record can speak for it.
 */

export type FileOwner =
  | {
      kind: 'DOCUMENT_REVISION';
      revisionId: string;
      documentId: string;
      projectId: string;
    }
  | { kind: 'DPR_ATTACHMENT'; attachmentId: string; dprId: string; projectId: string }
  | { kind: 'CONTRACT_ATTACHMENT'; attachmentId: string; contractId: string; projectId: string }
  | { kind: 'GUARANTEE_ATTACHMENT'; attachmentId: string; guaranteeId: string; projectId: string }
  | { kind: 'IPA_ATTACHMENT'; attachmentId: string; applicationId: string; projectId: string }
  | { kind: 'IPC_ATTACHMENT'; attachmentId: string; certificateId: string; projectId: string }
  // The first owner with no project at all (the class doc's "future organization document"
  // case): an org's invoice-branding logo. Reachable by organization view access, not membership.
  | { kind: 'ORGANIZATION_LOGO'; organizationId: string }
  // The rendered PDF for a client invoice. `ClientInvoiceController` gates every invoice route on
  // one organization-level permission (manage:accounts-receivable), not project membership — see
  // ORGANIZATION_LOGO's note — so the document mirrors that rather than resolving a project.
  | { kind: 'INVOICE_DOCUMENT'; invoiceId: string }
  // The rendered PDF for a posted payment receipt — same rule as INVOICE_DOCUMENT: the receipts
  // controller gates every route on manage:receivable, not project membership.
  | { kind: 'RECEIPT_DOCUMENT'; receiptId: string }
  // Procurement attachments: quotation evidence on a PO revision, delivery note on a GRN.
  // Neither lives inside a project — they are org-level records. Reachable by procurementView.
  | {
      kind: 'PO_REVISION_ATTACHMENT';
      attachmentId: string;
      revisionId: string;
      organizationId: string;
      /**
       * ADR-044 — the file is a quotation photo (a QuotePhoto) attached to the PO as the award's
       * evidence. It shows supplier prices, so it keeps the quote photo's money rule rather than
       * the plain view:procurement rule of other PO attachments.
       */
      quotationEvidence: boolean;
      /** The quotation's project when quotationEvidence (review M2), else null. */
      quotationProjectId: string | null;
    }
  | { kind: 'GRN_ATTACHMENT'; attachmentId: string; grnId: string; organizationId: string }
  // ADR-044 — a page of a store's paper quotation. Money evidence (it shows supplier prices), so it
  // is readable only with view:procurement AND view:commitment-ledger. The same rule follows the
  // photo when it is attached to the PO as quotation evidence (PO_REVISION_ATTACHMENT
  // quotationEvidence), so money-blind roles cannot reach it through the order either.
  | {
      kind: 'QUOTATION_PHOTO';
      photoId: string;
      quoteId: string;
      quotationRequestId: string;
      /** The quotation's project — reachable only by its members or the bypass roles (review M2). */
      projectId: string | null;
    }
  // ADR-045 — a page of a store's receipt / invoice (it shows what was paid): the QUOTATION_PHOTO rule.
  | {
      kind: 'STORE_DOCUMENT_PHOTO';
      photoId: string;
      storeDocumentId: string;
      projectId: string | null;
    };

/**
 * ADR-044 — who may see a quotation photo's bytes: procurement access plus cost visibility
 * (view:commitment-ledger). The quotation read models use the same rule for `photosVisible`.
 */
export function canSeeQuotationPhotos(identity: RequestIdentity): boolean {
  return (
    identity.permissions.includes(PERMISSIONS.procurementView) &&
    identity.permissions.includes(PERMISSIONS.commitmentsView)
  );
}

export interface FileOwnership {
  fileId: string;
  organizationId: string;
  uploadedBy: string;
  lifecycle: 'TEMPORARY' | 'BOUND' | 'IMMUTABLE';
  status: 'PENDING' | 'READY';
  /** Empty when nothing has bound the file yet — see the class note. */
  owners: FileOwner[];
}

// An unowned upload is a temporary file not yet bound to any record. Reaching one that isn't yours
// is an administrative/support act, so this stays deliberately narrow — only platform ADMIN, not
// the broader project-membership bypass set. (The old dev-vocabulary names matched no real role.)
const UNOWNED_FILE_BYPASS_ROLES = new Set(['ADMIN']);

@Injectable()
export class FileAuthorizationService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
  ) {}

  /**
   * Everything that claims this file, resolved in one read.
   *
   * Organisation scope is applied here and nowhere else downstream: a file from another tenant is
   * reported as *not found*, not as forbidden, because confirming that an id exists in another
   * organisation is itself a disclosure.
   */
  async resolveOwnership(identity: RequestIdentity, fileId: string): Promise<FileOwnership> {
    const file = await this.tenancy.getClient().platformFile.findFirst({
      where: { id: fileId, organizationId: identity.activeOrganizationId },
      select: {
        id: true,
        organizationId: true,
        uploadedBy: true,
        lifecycle: true,
        status: true,
        // The register holds files on REVISIONS now, not on the document. A file that reached a
        // superseded revision is still readable by the project — that is the point of keeping it.
        documentRevisions: {
          select: {
            id: true,
            projectDocumentId: true,
            document: { select: { projectId: true } },
          },
        },
        dprAttachments: { select: { id: true, dprId: true, dpr: { select: { projectId: true } } } },
        // Every attachment kind reaches a project by a different path, and each path is the
        // scoping. Resolving them here rather than per controller is what stops a module shipping
        // an upload route that forgets to authorize the download.
        contractAttachments: {
          select: { id: true, contractId: true, contract: { select: { projectId: true } } },
        },
        guaranteeAttachments: {
          select: {
            id: true,
            guaranteeId: true,
            guarantee: { select: { contract: { select: { projectId: true } } } },
          },
        },
        ipaAttachments: {
          select: {
            id: true,
            applicationId: true,
            application: { select: { contract: { select: { projectId: true } } } },
          },
        },
        ipcAttachments: {
          select: {
            id: true,
            certificateId: true,
            certificate: {
              select: { application: { select: { contract: { select: { projectId: true } } } } },
            },
          },
        },
        organizationLogoFor: { select: { id: true } },
        invoiceDocumentFor: { select: { id: true } },
        receiptDocumentFor: { select: { id: true } },
        poRevisionAttachments: {
          select: {
            id: true,
            purchaseOrderRevisionId: true,
            organizationId: true,
          },
        },
        grnAttachments: {
          select: {
            id: true,
            goodsReceiptNoteId: true,
            organizationId: true,
          },
        },
        quotePhoto: {
          select: {
            id: true,
            quoteId: true,
            quote: { select: { quotationRequestId: true, quotationRequest: { select: { projectId: true } } } },
          },
        },
        storeDocumentPhoto: {
          select: {
            id: true,
            storeDocumentId: true,
            storeDocument: { select: { quotationRequest: { select: { projectId: true } } } },
          },
        },
      },
    });
    if (!file) throw new NotFoundException(`File ${fileId} not found`);

    const owners: FileOwner[] = [
      ...file.documentRevisions.map((revision) => ({
        kind: 'DOCUMENT_REVISION' as const,
        revisionId: revision.id,
        documentId: revision.projectDocumentId,
        projectId: revision.document.projectId,
      })),
      ...file.dprAttachments.map((attachment) => ({
        kind: 'DPR_ATTACHMENT' as const,
        attachmentId: attachment.id,
        dprId: attachment.dprId,
        projectId: attachment.dpr.projectId,
      })),
      ...file.contractAttachments.map((attachment) => ({
        kind: 'CONTRACT_ATTACHMENT' as const,
        attachmentId: attachment.id,
        contractId: attachment.contractId,
        projectId: attachment.contract.projectId,
      })),
      ...file.guaranteeAttachments.map((attachment) => ({
        kind: 'GUARANTEE_ATTACHMENT' as const,
        attachmentId: attachment.id,
        guaranteeId: attachment.guaranteeId,
        projectId: attachment.guarantee.contract.projectId,
      })),
      ...file.ipaAttachments.map((attachment) => ({
        kind: 'IPA_ATTACHMENT' as const,
        attachmentId: attachment.id,
        applicationId: attachment.applicationId,
        projectId: attachment.application.contract.projectId,
      })),
      ...file.ipcAttachments.map((attachment) => ({
        kind: 'IPC_ATTACHMENT' as const,
        attachmentId: attachment.id,
        certificateId: attachment.certificateId,
        projectId: attachment.certificate.application.contract.projectId,
      })),
      // `organizationLogoFor` holds the Organization row(s) that reference this file as their
      // logo — in practice at most one, since branding is updated by replacing the reference.
      ...file.organizationLogoFor.map((org) => ({
        kind: 'ORGANIZATION_LOGO' as const,
        organizationId: org.id,
      })),
      ...file.invoiceDocumentFor.map((invoice) => ({
        kind: 'INVOICE_DOCUMENT' as const,
        invoiceId: invoice.id,
      })),
      ...file.receiptDocumentFor.map((receipt) => ({
        kind: 'RECEIPT_DOCUMENT' as const,
        receiptId: receipt.id,
      })),
      ...file.poRevisionAttachments.map((a) => ({
        kind: 'PO_REVISION_ATTACHMENT' as const,
        attachmentId: a.id,
        revisionId: a.purchaseOrderRevisionId,
        organizationId: a.organizationId,
        // A quotation photo stays a quotation photo wherever it is attached.
        quotationEvidence: Boolean(file.quotePhoto),
        quotationProjectId: file.quotePhoto?.quote.quotationRequest?.projectId ?? null,
      })),
      ...file.grnAttachments.map((a) => ({
        kind: 'GRN_ATTACHMENT' as const,
        attachmentId: a.id,
        grnId: a.goodsReceiptNoteId,
        organizationId: a.organizationId,
      })),
      ...(file.quotePhoto
        ? [
            {
              kind: 'QUOTATION_PHOTO' as const,
              photoId: file.quotePhoto.id,
              quoteId: file.quotePhoto.quoteId,
              quotationRequestId: file.quotePhoto.quote.quotationRequestId,
              projectId: file.quotePhoto.quote.quotationRequest?.projectId ?? null,
            },
          ]
        : []),
      ...(file.storeDocumentPhoto
        ? [
            {
              kind: 'STORE_DOCUMENT_PHOTO' as const,
              photoId: file.storeDocumentPhoto.id,
              storeDocumentId: file.storeDocumentPhoto.storeDocumentId,
              projectId: file.storeDocumentPhoto.storeDocument.quotationRequest?.projectId ?? null,
            },
          ]
        : []),
    ];

    return {
      fileId: file.id,
      organizationId: file.organizationId,
      uploadedBy: file.uploadedBy,
      lifecycle: file.lifecycle,
      status: file.status,
      owners,
    };
  }

  /**
   * May this caller see the bytes?
   *
   * One owner granting access is enough — a file legitimately attached to two records is readable
   * by anyone who can read either. Denial is the *absence* of any grant, so a caller with no
   * qualifying access gets 403 rather than the first owner's error.
   */
  async assertCanRead(identity: RequestIdentity, fileId: string): Promise<FileOwnership> {
    const ownership = await this.resolveOwnership(identity, fileId);

    if (ownership.owners.length === 0) {
      this.assertOwnUpload(identity, ownership, 'read');
      return ownership;
    }

    for (const owner of ownership.owners) {
      if (await this.canReachOwner(identity, owner)) return ownership;
    }
    throw new ForbiddenException('You do not have access to the record this file belongs to.');
  }

  /**
   * May this caller destroy the bytes?
   *
   * Deliberately much narrower than read, and deliberately not the mirror of it:
   *
   * - **IMMUTABLE** — never. The owning record has finalised; a correction appends a new file.
   * - **BOUND** — not through the file API. A bound file is deleted by detaching it from its
   *   owner, so that the owner's own rules (may this document be removed? is the report still
   *   open?) run, and so the register and the bytes cannot fall out of step. `/files/:id` refusing
   *   this is the point: one deletion path, through the aggregate.
   * - **TEMPORARY** — the uploader, or a bypass role, may discard their own abandoned upload.
   */
  async assertCanDelete(identity: RequestIdentity, fileId: string): Promise<FileOwnership> {
    const ownership = await this.resolveOwnership(identity, fileId);

    if (ownership.lifecycle === 'IMMUTABLE') {
      throw new ForbiddenException(
        'This file is part of a finalised record and cannot be deleted. Attach a replacement instead.',
      );
    }
    if (ownership.owners.length > 0) {
      throw new ForbiddenException(
        'This file belongs to a record. Remove it from that record rather than deleting the file.',
      );
    }

    this.assertOwnUpload(identity, ownership, 'delete');
    return ownership;
  }

  /**
   * May this caller change the file's own metadata — confirm an upload, bind it, replace it?
   *
   * Confirming is the live case: it happens between presign and attach, while the file is still
   * unowned, so it is the uploader's act. Once a record owns the file its content is fixed and
   * changes go through that record.
   */
  async assertCanWrite(identity: RequestIdentity, fileId: string): Promise<FileOwnership> {
    const ownership = await this.resolveOwnership(identity, fileId);

    if (ownership.lifecycle === 'IMMUTABLE') {
      throw new ForbiddenException('This file is part of a finalised record and cannot be changed.');
    }
    if (ownership.owners.length > 0) {
      throw new ForbiddenException(
        'This file belongs to a record. Change it through that record rather than directly.',
      );
    }

    this.assertOwnUpload(identity, ownership, 'change');
    return ownership;
  }

  /**
   * Whether the caller can reach the business record behind one binding.
   *
   * Every owner resolves to a project today, and project membership is the rule for all of them.
   * They stay separate cases rather than collapsing into one, because they will not stay the
   * same — a commercial attachment will want `view:contract` alongside membership long before a
   * drawing does, and the shape that anticipates it costs one line each.
   *
   * The **future organization document** owner attaches here: it will be the first case whose
   * answer is an organization permission rather than project membership, which is precisely why
   * `OrganizationDocument` is planned as a separate aggregate rather than a nullable-project
   * variant of this one. A shared table would force this switch to guess which rule applied.
   */
  private async canReachOwner(identity: RequestIdentity, owner: FileOwner): Promise<boolean> {
    switch (owner.kind) {
      case 'DOCUMENT_REVISION':
      case 'DPR_ATTACHMENT':
      case 'CONTRACT_ATTACHMENT':
      case 'GUARANTEE_ATTACHMENT':
      case 'IPA_ATTACHMENT':
      case 'IPC_ATTACHMENT':
        if (!identity.permissions.includes(PERMISSIONS.projectsView)) return false;
        return this.isProjectMember(identity, owner.projectId);
      // The first owner kind answered by an organization permission rather than project
      // membership (the class doc predicted this). `resolveOwnership` already scoped the query
      // to the caller's own tenant, so any org member who can see organization settings can see
      // the logo they are already branded with.
      case 'ORGANIZATION_LOGO':
        return identity.permissions.includes(PERMISSIONS.organizationsView);
      case 'INVOICE_DOCUMENT':
      case 'RECEIPT_DOCUMENT':
        return identity.permissions.includes(PERMISSIONS.receivablesManage);
      // Procurement attachments are org-level (no project). Any holder of procurementView can
      // read them — the same guard that gates the PO and GRN list endpoints.
      case 'PO_REVISION_ATTACHMENT':
        return owner.quotationEvidence
          ? this.canReachQuotationPhoto(identity, owner.quotationProjectId)
          : identity.permissions.includes(PERMISSIONS.procurementView);
      case 'GRN_ATTACHMENT':
        return identity.permissions.includes(PERMISSIONS.procurementView);
      // ADR-044 §5 — photos are money: never view:procurement alone (a money-blind Project Manager
      // or Site Engineer holds that).
      case 'QUOTATION_PHOTO':
      case 'STORE_DOCUMENT_PHOTO':
        return this.canReachQuotationPhoto(identity, owner.projectId);
    }
  }

  /**
   * A quotation photo: the money rule, and — for a project's quotation — the same project access
   * as the quotation detail (members, or the project-access bypass roles). Review M2.
   */
  private async canReachQuotationPhoto(identity: RequestIdentity, projectId: string | null): Promise<boolean> {
    if (!canSeeQuotationPhotos(identity)) return false;
    return projectId ? this.isProjectMember(identity, projectId) : true;
  }

  /**
   * `ProjectAccessService.assertMember` throws for both "no such project" and "not a member", and
   * here neither is an error — they are one owner failing to grant access while another may still
   * grant it.
   */
  private async isProjectMember(identity: RequestIdentity, projectId: string): Promise<boolean> {
    try {
      await this.projectAccess.assertMember(identity, projectId);
      return true;
    } catch {
      return false;
    }
  }

  private assertOwnUpload(
    identity: RequestIdentity,
    ownership: FileOwnership,
    verb: string,
  ): void {
    if (ownership.uploadedBy === identity.userId) return;
    if (identity.roles.some((role) => UNOWNED_FILE_BYPASS_ROLES.has(role))) return;
    throw new ForbiddenException(
      `Only the uploader can ${verb} a file that is not attached to a record.`,
    );
  }
}
