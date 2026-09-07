import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DocumentCategory, ProjectDocumentStatus } from '@erp/types';
import type { DocumentRevisionPurpose, DocumentRevisionStatus } from '@erp/types';

/**
 * These take the *values*, not either enum declaration.
 *
 * Prisma generates its own enums and `@erp/types` declares matching ones; they are structurally
 * identical strings and nominally different types, so a signature naming one of them forces a cast
 * at every call site in the other's world. The string-literal union is what both actually are.
 */
type DocumentStatusValue = `${ProjectDocumentStatus}`;
type RevisionStatusValue = `${DocumentRevisionStatus}`;
type CategoryValue = `${DocumentCategory}`;
type PurposeValue = `${DocumentRevisionPurpose}`;

/**
 * What may be done to a controlled document, and in which state.
 *
 * Pure functions over status — no database, no identity, no Nest. The service asks these
 * questions; it does not re-derive the answers, and neither does the browser. The frontend calls
 * the same rules through the capability flags on the read model, so a hidden button and a refused
 * request always agree.
 *
 * The shape of the lifecycle, and why it is this small:
 *
 *   DRAFT ──issue──> ISSUED ──supersede──> SUPERSEDED
 *     │                 │
 *     │                 ├──withdraw──> WITHDRAWN
 *     └──delete         └──archive───> ARCHIVED
 *
 * There is no APPROVED. Nothing in the platform binds an approval workflow to document issuance,
 * and a status that implies a control which does not run is the fake-approval defect the
 * accounting round-2 review spent a phase removing from journals. When a workflow binding exists,
 * it attaches to `issue` — the act that already carries the weight.
 */

/** A document whose content is still being assembled. Metadata and files are freely editable. */
export function isEditableDocumentStatus(status: DocumentStatusValue): boolean {
  return status === ProjectDocumentStatus.DRAFT;
}

/**
 * States in which the record is closed to change but still readable.
 *
 * Metadata on an ISSUED document remains editable in one narrow respect — see
 * {@link assertMetadataEditable} — because expiry dates and the responsible person are facts about
 * the *world*, not about the issued revision, and they change without the document changing.
 */
export function isTerminalDocumentStatus(status: DocumentStatusValue): boolean {
  return (
    status === ProjectDocumentStatus.SUPERSEDED ||
    status === ProjectDocumentStatus.WITHDRAWN ||
    status === ProjectDocumentStatus.ARCHIVED
  );
}

/** Fields that stay editable after issue, because they describe the world rather than the file. */
export const POST_ISSUE_EDITABLE_FIELDS = [
  'title',
  'responsibleUserId',
  'issuerName',
  'issuedAt',
  'validFrom',
  'expiresAt',
] as const;

export type PostIssueEditableField = (typeof POST_ISSUE_EDITABLE_FIELDS)[number];

/**
 * Which metadata this status admits.
 *
 * DRAFT: everything, including the number, the category and the discipline — the record has not
 * been issued, so nothing downstream references it yet.
 *
 * ISSUED: only the world-facing facts. The number and the category are how the document is cited
 * on site and in correspondence; changing them after issue would silently re-identify a record
 * other people are holding a printout of.
 *
 * Terminal states: nothing. History is not edited.
 */
export function assertMetadataEditable(
  status: DocumentStatusValue,
  fields: readonly string[],
): void {
  if (status === ProjectDocumentStatus.DRAFT) return;

  if (isTerminalDocumentStatus(status)) {
    throw new ForbiddenException(
      `A ${status.toLowerCase()} document is history and cannot be edited. ` +
        'Register a replacement document instead.',
    );
  }

  const locked = fields.filter(
    (field) => !POST_ISSUE_EDITABLE_FIELDS.includes(field as PostIssueEditableField),
  );
  if (locked.length > 0) {
    throw new ForbiddenException(
      `Once a document is issued its ${locked.join(', ')} cannot change — it is how the ` +
        'document is cited. Register a new document, or issue a new revision.',
    );
  }
}

/**
 * Hard delete, and why it is this narrow.
 *
 * A DRAFT that has never been issued is working material: nobody has been told to rely on it, no
 * revision of it is history, so discarding it destroys nothing. Anything else is a controlled
 * record, and controlled records are withdrawn, archived or superseded — never removed, because
 * the reason a register exists is that its history survives the people who made it.
 */
export function assertDeletable(
  status: DocumentStatusValue,
  revisionStatuses: readonly RevisionStatusValue[],
): void {
  if (status !== ProjectDocumentStatus.DRAFT) {
    throw new ForbiddenException(
      `A ${status.toLowerCase()} document cannot be deleted. Withdraw or archive it instead — ` +
        'a controlled record keeps its history.',
    );
  }
  const issued = revisionStatuses.some((s) => s !== 'DRAFT');
  if (issued) {
    throw new ForbiddenException(
      'This document has an issued revision in its history and cannot be deleted. ' +
        'Withdraw or archive it instead.',
    );
  }
}

/** Issue: promotes the draft revision, and the document with it if this is its first issue. */
export function assertIssuable(
  documentStatus: DocumentStatusValue,
  revisionStatus: RevisionStatusValue,
): void {
  if (isTerminalDocumentStatus(documentStatus)) {
    throw new BadRequestException(
      `A ${documentStatus.toLowerCase()} document cannot issue a revision.`,
    );
  }
  if (revisionStatus !== 'DRAFT') {
    throw new BadRequestException(
      `Only a draft revision can be issued (this one is ${revisionStatus.toLowerCase()}).`,
    );
  }
}

/**
 * A new revision may only start from an issued document.
 *
 * Starting one on a DRAFT would produce two drafts and no answer to "which one gets issued" — the
 * same ambiguity the one-DRAFT partial index refuses at the database. A draft that is wrong is
 * corrected by replacing its file, not by stacking another draft on top of it.
 */
export function assertRevisionCreatable(
  documentStatus: DocumentStatusValue,
  hasDraftRevision: boolean,
): void {
  if (isTerminalDocumentStatus(documentStatus)) {
    throw new BadRequestException(
      `A ${documentStatus.toLowerCase()} document cannot take a new revision.`,
    );
  }
  if (hasDraftRevision) {
    throw new BadRequestException(
      'This document already has a draft revision. Issue it, or replace its file, before ' +
        'starting another.',
    );
  }
}

/**
 * Replacing the file behind a revision.
 *
 * Permitted on a DRAFT and on nothing else. An issued revision's file is IMMUTABLE at the storage
 * layer as well, so this is the second of two guards rather than the only one — but it is the one
 * that produces a sentence a person can act on instead of a 403 about file lifecycle.
 */
export function assertFileReplaceable(revisionStatus: RevisionStatusValue): void {
  if (revisionStatus !== 'DRAFT') {
    throw new ForbiddenException(
      'An issued revision cannot be changed. Create a new revision to supply new content — ' +
        'the issued one stays readable as history.',
    );
  }
}

export function assertWithdrawable(status: DocumentStatusValue): void {
  if (status !== ProjectDocumentStatus.ISSUED) {
    throw new BadRequestException(
      `Only an issued document can be withdrawn (this one is ${status.toLowerCase()}).`,
    );
  }
}

/** Archiving takes a document out of daily use. It is reachable from every non-archived state. */
export function assertArchivable(status: DocumentStatusValue): void {
  if (status === ProjectDocumentStatus.ARCHIVED) {
    throw new BadRequestException('This document is already archived.');
  }
}

export function assertSupersedable(
  status: DocumentStatusValue,
  successorStatus: DocumentStatusValue,
): void {
  if (status !== ProjectDocumentStatus.ISSUED) {
    throw new BadRequestException(
      `Only an issued document can be superseded (this one is ${status.toLowerCase()}).`,
    );
  }
  if (successorStatus !== ProjectDocumentStatus.ISSUED) {
    throw new BadRequestException(
      'The replacement document must itself be issued before it can supersede another.',
    );
  }
}

/**
 * Revision purpose is drawing vocabulary.
 *
 * "Issued for construction" on an insurance certificate is not a harmless extra field — it is the
 * register telling the site that a policy document is what they should be building from. Purposes
 * are therefore accepted on drawings and refused everywhere else, rather than offered everywhere
 * and quietly ignored.
 */
export function assertPurposeAllowed(
  category: CategoryValue,
  purpose: PurposeValue | null | undefined,
): void {
  if (!purpose) return;
  if (category !== DocumentCategory.DRAWING) {
    throw new BadRequestException(
      'A revision purpose (for review, for construction, as-built) applies to drawings only.',
    );
  }
}

/**
 * Validity dates must describe a real window.
 *
 * A document valid from a date after it expires is not a document anyone can act on, and storing
 * it would make every derived validity state meaningless for that row.
 */
export function assertValidityWindow(
  validFrom: Date | null | undefined,
  expiresAt: Date | null | undefined,
): void {
  if (validFrom && expiresAt && validFrom.getTime() > expiresAt.getTime()) {
    throw new BadRequestException('The valid-from date must fall on or before the expiry date.');
  }
}
