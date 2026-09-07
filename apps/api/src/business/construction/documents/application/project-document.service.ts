import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import type {
  DocumentRevisionPurpose,
  DocumentRevisionStatus,
  ProjectDocumentStatus as PrismaDocumentStatus,
} from '@prisma/client';
import {
  DocumentValidity,
  PERMISSIONS,
  type DocumentActivityEntry,
  type DocumentRevisionResponse,
  type ProjectDocumentCapabilities,
  type ProjectDocumentDetailResponse,
  type ProjectDocumentListResponse,
  type ProjectDocumentResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { PlatformFileService } from '../../../../platform/files/application/platform-file.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import {
  ProjectDocumentRepository,
  type DocumentRow,
  type RevisionRow,
} from '../infrastructure/project-document.repository.js';
import {
  DEFAULT_EXPIRING_SOON_DAYS,
  deriveValidity,
} from '../domain/document-validity.policy.js';
import {
  documentNumberKey,
  normaliseDocumentNumber,
  normaliseRevisionCode,
  normaliseTitle,
} from '../domain/document-number.policy.js';
import {
  assertArchivable,
  assertDeletable,
  assertFileReplaceable,
  assertIssuable,
  assertMetadataEditable,
  assertPurposeAllowed,
  assertRevisionCreatable,
  assertSupersedable,
  assertValidityWindow,
  assertWithdrawable,
  isEditableDocumentStatus,
  isTerminalDocumentStatus,
} from '../domain/document-lifecycle.policy.js';
import type {
  CreateDocumentRevisionDto,
  CreateProjectDocumentDto,
  IssueRevisionDto,
  ListProjectDocumentsQueryDto,
  ReplaceRevisionFileDto,
  SupersedeDocumentDto,
  UpdateProjectDocumentDto,
  WithdrawDocumentDto,
} from '../presentation/dto/project-document.dto.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 25;

/**
 * The controlled project document register.
 *
 * What changed in Phase 7A, and why it is not a refactor: this used to attach a file to a project
 * and call it a document. There was no identity beyond a title, no status, no revision, no expiry
 * and no accountability — so "which drawing is current?" and "has this permit lapsed?", the two
 * questions a construction document register exists to answer, could not be asked of it.
 *
 * The model now separates three things that were one:
 *
 *   the CONTROLLED RECORD   status, identity, responsibility, validity — this aggregate
 *   its REVISIONS           append-only, one current, each holding exactly one file
 *   the FILE                storage, with its own lifecycle (TEMPORARY / BOUND / IMMUTABLE)
 *
 * The invariant everything else rests on: **an issued revision is never rewritten.** Its file is
 * frozen at the storage layer on issue, the row is never mutated afterwards, and new content
 * always arrives as a new revision that supersedes it. That is what makes the history worth
 * keeping — and it is enforced in three independent places (this service, the file authorization
 * service, and two partial unique indexes), because a rule that lives only in the layer that
 * happens to be called first is not enforced at all.
 */
@Injectable()
export class ProjectDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: ProjectDocumentRepository,
    private readonly projectAccess: ProjectAccessService,
    private readonly files: PlatformFileService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly config: ConfigService,
  ) {}

  /**
   * How many days before expiry a document enters the attention queue.
   *
   * Server-owned and reported back on every summary, because a threshold written into a React
   * component is a product policy nobody agreed to and nobody can see. 30 days is the ACCO default
   * and it is a documented product decision, not an arbitrary constant.
   */
  private get expiringSoonDays(): number {
    const configured = Number(this.config.get<string>('DOCUMENT_EXPIRY_WARNING_DAYS'));
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_EXPIRING_SOON_DAYS;
  }

  // --- reads ---------------------------------------------------------------------------------

  async list(
    identity: RequestIdentity,
    projectId: string,
    query: ListProjectDocumentsQueryDto,
  ): Promise<ProjectDocumentListResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const { today, soonCutoff } = this.dateWindows();

    const { items, total } = await this.repo.findPage(prisma, org, projectId, {
      search: query.search,
      category: query.category,
      discipline: query.discipline,
      status: query.status,
      responsibleUserId: query.responsibleUserId,
      ...this.validityWindow(query.validity, today, soonCutoff),
      page,
      pageSize,
    });

    const [summaryCounts, names] = await Promise.all([
      this.repo.summaryCounts(prisma, org, projectId, today, soonCutoff),
      this.repo.resolveUserNames(prisma, org, this.userIdsIn(items)),
    ]);

    return {
      items: items.map((row) => this.toDocumentResponse(row, names)),
      total,
      page,
      pageSize,
      summary: { ...summaryCounts, expiringSoonDays: this.expiringSoonDays },
    };
  }

  async findOne(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
  ): Promise<ProjectDocumentDetailResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    const document = await this.requireDocument(projectId, documentId, identity);
    const revisions = await this.repo.findRevisions(prisma, documentId);
    const activity = await this.repo.findActivity(
      prisma,
      org,
      documentId,
      revisions.map((r) => r.id),
    );

    const names = await this.repo.resolveUserNames(prisma, org, [
      ...this.userIdsIn([document]),
      ...revisions.flatMap((r) => [r.createdBy, r.issuedBy ?? '']),
      ...activity.map((a) => a.userId),
    ]);

    return {
      document: this.toDocumentResponse(document, names),
      revisions: revisions.map((r) => this.toRevisionResponse(r, document.currentRevisionId, names)),
      activity: activity.map(
        (entry): DocumentActivityEntry => ({
          id: entry.id,
          action: entry.action,
          sourceCommand: entry.sourceCommand ?? '',
          actorUserId: entry.userId,
          actorName: names.get(entry.userId) ?? null,
          reason: entry.reason ?? null,
          occurredAt: entry.createdAt.toISOString(),
        }),
      ),
    };
  }

  /**
   * What this caller may do, resolved once on the server.
   *
   * The browser hides what it is told to hide; it does not decide. Every one of these flags has a
   * server-side guard behind it, so a hidden button and a refused request cannot disagree.
   */
  capabilities(identity: RequestIdentity): ProjectDocumentCapabilities {
    const canManage = identity.permissions.includes(PERMISSIONS.projectDocumentsManage);
    const canIssue = identity.permissions.includes(PERMISSIONS.projectDocumentsIssue);
    return { canCreate: canManage, canEdit: canManage, canIssue, canArchive: canIssue };
  }

  // --- writes --------------------------------------------------------------------------------

  /**
   * Register a controlled document: the record and its first revision, in one transaction.
   *
   * The document is DRAFT and the revision is DRAFT. **Uploading a file is not issuance** — the
   * bytes arriving says nothing about whether the site may build from them, and conflating the two
   * is exactly how a shared folder becomes the thing a register is supposed to replace.
   */
  async create(identity: RequestIdentity, projectId: string, dto: CreateProjectDocumentDto) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    const documentNumber = normaliseDocumentNumber(dto.documentNumber);
    const key = documentNumberKey(dto.documentNumber);
    const title = normaliseTitle(dto.title);
    const revisionCode = normaliseRevisionCode(dto.revisionCode);

    assertPurposeAllowed(dto.category, dto.purpose);
    const issuedAt = this.parseDate(dto.issuedAt);
    const validFrom = this.parseDate(dto.validFrom);
    const expiresAt = this.parseDate(dto.expiresAt);
    assertValidityWindow(validFrom, expiresAt);

    const clash = await this.repo.findByNumber(prisma, projectId, key);
    if (clash) {
      throw new BadRequestException(
        `Document number "${documentNumber}" is already registered on this project.`,
      );
    }

    const responsibleUserId = await this.resolveResponsible(projectId, dto.responsibleUserId);
    await this.assertFileAttachable(org, dto.platformFileId, identity.userId);

    const document = await prisma.$transaction(async (tx) => {
      const created = await this.repo.createDocument(tx, {
        organizationId: org,
        projectId,
        documentNumber,
        documentNumberNormalized: key,
        title,
        category: dto.category,
        discipline: dto.discipline ?? null,
        responsibleUserId,
        issuerName: dto.issuerName?.trim() || null,
        issuedAt,
        validFrom,
        expiresAt,
        createdBy: identity.userId,
      });

      const revision = await this.repo.createRevision(tx, {
        organizationId: org,
        projectDocumentId: created.id,
        platformFileId: dto.platformFileId,
        revisionNumber: 1,
        revisionCode,
        purpose: dto.purpose ?? null,
        notes: dto.notes?.trim() || null,
        createdBy: identity.userId,
      });
      await this.repo.setCurrentRevision(tx, created.id, revision.id);

      await this.audit(tx, identity, {
        action: 'CREATE',
        resourceType: 'ProjectDocument',
        resourceId: created.id,
        sourceCommand: 'projectDocument.create',
        eventType: 'PROJECT_DOCUMENT_REGISTERED',
        idempotencyKey: `project-document-create-${created.id}`,
        after: { projectId, documentNumber, title, category: dto.category, status: 'DRAFT' },
      });
      return created;
    });

    // Binding takes the file out of reach of the abandoned-upload sweep and of DELETE /files/:id:
    // from here it belongs to a revision, and only the revision can release it. Deliberately
    // outside the transaction — it is a second aggregate's state change, and a failure here leaves
    // a TEMPORARY file the sweep reclaims rather than a document with no file at all.
    await this.files.bind(dto.platformFileId, `document revision 1 of ${document.id}`);
    return this.findOne(identity, projectId, document.id);
  }

  async update(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
    dto: UpdateProjectDocumentDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const document = await this.requireDocument(projectId, documentId, identity);

    // `undefined` means "not supplied"; `null` means "clear this". Collapsing them would make
    // removing an expiry date impossible, which is the edit someone makes when a permit turns out
    // to be perpetual.
    const supplied = Object.keys(dto).filter((k) => dto[k as keyof UpdateProjectDocumentDto] !== undefined);
    if (supplied.length === 0) return this.findOne(identity, projectId, documentId);
    assertMetadataEditable(document.status, supplied);

    const data: Prisma.ProjectDocumentUpdateInput = {};
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (dto.documentNumber !== undefined) {
      const documentNumber = normaliseDocumentNumber(dto.documentNumber);
      const key = documentNumberKey(dto.documentNumber);
      if (key !== document.documentNumberNormalized) {
        const clash = await this.repo.findByNumber(this.tenancy.getClient(), projectId, key);
        if (clash) {
          throw new BadRequestException(
            `Document number "${documentNumber}" is already registered on this project.`,
          );
        }
      }
      data.documentNumber = documentNumber;
      data.documentNumberNormalized = key;
      before.documentNumber = document.documentNumber;
      after.documentNumber = documentNumber;
    }
    if (dto.title !== undefined) {
      data.title = normaliseTitle(dto.title);
      before.title = document.title;
      after.title = data.title;
    }
    if (dto.category !== undefined) {
      data.category = dto.category;
      before.category = document.category;
      after.category = dto.category;
    }
    if (dto.discipline !== undefined) {
      data.discipline = dto.discipline;
      before.discipline = document.discipline;
      after.discipline = dto.discipline;
    }
    if (dto.responsibleUserId !== undefined) {
      const resolved = await this.resolveResponsible(projectId, dto.responsibleUserId);
      data.responsibleUserId = resolved;
      before.responsibleUserId = document.responsibleUserId;
      after.responsibleUserId = resolved;
    }
    if (dto.issuerName !== undefined) {
      data.issuerName = dto.issuerName?.trim() || null;
      before.issuerName = document.issuerName;
      after.issuerName = data.issuerName;
    }

    const issuedAt = dto.issuedAt !== undefined ? this.parseDate(dto.issuedAt) : document.issuedAt;
    const validFrom =
      dto.validFrom !== undefined ? this.parseDate(dto.validFrom) : document.validFrom;
    const expiresAt =
      dto.expiresAt !== undefined ? this.parseDate(dto.expiresAt) : document.expiresAt;
    assertValidityWindow(validFrom, expiresAt);

    if (dto.issuedAt !== undefined) {
      data.issuedAt = issuedAt;
      before.issuedAt = document.issuedAt;
      after.issuedAt = issuedAt;
    }
    if (dto.validFrom !== undefined) {
      data.validFrom = validFrom;
      before.validFrom = document.validFrom;
      after.validFrom = validFrom;
    }
    if (dto.expiresAt !== undefined) {
      data.expiresAt = expiresAt;
      before.expiresAt = document.expiresAt;
      after.expiresAt = expiresAt;
    }

    await this.tenancy.getClient().$transaction(async (tx) => {
      await this.repo.updateDocument(tx, documentId, data);
      await this.audit(tx, identity, {
        action: 'UPDATE',
        resourceType: 'ProjectDocument',
        resourceId: documentId,
        sourceCommand: 'projectDocument.update',
        eventType: this.metadataEventType(supplied),
        idempotencyKey: `project-document-update-${documentId}-${Date.now()}`,
        before,
        after,
      });
    });
    return this.findOne(identity, projectId, documentId);
  }

  /**
   * Start a new revision of an issued document.
   *
   * The previous revision keeps its file and its place in the history. This is the whole point:
   * "upload the new one" destroys what it replaces, and a register that cannot show what the site
   * was building from last month is a folder with extra steps.
   */
  async createRevision(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
    dto: CreateDocumentRevisionDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;
    const document = await this.requireDocument(projectId, documentId, identity);

    const existing = await this.repo.findRevisionStatuses(prisma, documentId);
    assertRevisionCreatable(
      document.status,
      existing.some((r) => r.status === 'DRAFT'),
    );
    assertPurposeAllowed(document.category, dto.purpose);
    await this.assertFileAttachable(org, dto.platformFileId, identity.userId);

    const revisionNumber = await this.repo.nextRevisionNumber(prisma, documentId);
    const revisionCode = normaliseRevisionCode(dto.revisionCode);

    await prisma.$transaction(async (tx) => {
      const created = await this.repo.createRevision(tx, {
        organizationId: org,
        projectDocumentId: documentId,
        platformFileId: dto.platformFileId,
        revisionNumber,
        revisionCode,
        purpose: dto.purpose ?? null,
        notes: dto.notes?.trim() || null,
        createdBy: identity.userId,
      });
      await this.audit(tx, identity, {
        action: 'CREATE',
        resourceType: 'ProjectDocumentRevision',
        resourceId: created.id,
        sourceCommand: 'projectDocument.createRevision',
        eventType: 'PROJECT_DOCUMENT_REVISION_CREATED',
        idempotencyKey: `project-document-revision-create-${created.id}`,
        after: { documentId, revisionNumber, revisionCode, purpose: dto.purpose ?? null },
      });
      return created;
    });

    await this.files.bind(dto.platformFileId, `document revision ${revisionNumber} of ${documentId}`);
    return this.findOne(identity, projectId, documentId);
  }

  /**
   * Swap the file behind a DRAFT revision.
   *
   * The old draft file is discarded rather than orphaned — the register's previous delete left the
   * bytes behind forever (Phase 7 audit P1-2), and a replace path that did the same would leak on
   * every correction rather than once per removal.
   */
  async replaceRevisionFile(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
    revisionId: string,
    dto: ReplaceRevisionFileDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;
    await this.requireDocument(projectId, documentId, identity);

    const revision = await this.repo.findRevision(prisma, org, documentId, revisionId);
    if (!revision) throw new NotFoundException(`Revision ${revisionId} not found`);
    assertFileReplaceable(revision.status);
    if (revision.platformFileId === dto.platformFileId) {
      return this.findOne(identity, projectId, documentId);
    }
    await this.assertFileAttachable(org, dto.platformFileId, identity.userId);

    const previousFileId = revision.platformFileId;
    await prisma.$transaction(async (tx) => {
      await this.repo.updateRevision(tx, revisionId, {
        platformFile: { connect: { id: dto.platformFileId } },
      });
      await this.audit(tx, identity, {
        action: 'UPDATE',
        resourceType: 'ProjectDocumentRevision',
        resourceId: revisionId,
        sourceCommand: 'projectDocument.replaceRevisionFile',
        eventType: 'PROJECT_DOCUMENT_REVISION_FILE_REPLACED',
        idempotencyKey: `project-document-revision-replace-${revisionId}-${Date.now()}`,
        before: { platformFileId: previousFileId },
        after: { platformFileId: dto.platformFileId },
      });
    });

    await this.files.bind(dto.platformFileId, `document revision ${revision.revisionNumber} of ${documentId}`);
    await this.files.discardIfUnreferenced(previousFileId);
    return this.findOne(identity, projectId, documentId);
  }

  /**
   * Issue the draft revision. The transaction that makes the register a control.
   *
   * Five things happen together or not at all:
   *
   *   1. the draft revision becomes ISSUED and is stamped with who issued it, and when
   *   2. the previously issued revision becomes SUPERSEDED — its file untouched, still readable
   *   3. the document points at the new revision
   *   4. the document itself becomes ISSUED, if this is its first issue
   *   5. the audit event is written
   *
   * Then, outside the transaction, the new revision's file is frozen IMMUTABLE. The ordering is
   * deliberate: the freeze is idempotent and re-runnable, whereas a half-applied supersession
   * would leave two revisions claiming to be current — which is why the partial unique index
   * exists as the backstop, and why no intermediate state here can expose two issued revisions.
   */
  async issueRevision(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
    revisionId: string,
    dto: IssueRevisionDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;
    const document = await this.requireDocument(projectId, documentId, identity);

    const revision = await this.repo.findRevision(prisma, org, documentId, revisionId);
    if (!revision) throw new NotFoundException(`Revision ${revisionId} not found`);
    assertIssuable(document.status, revision.status);

    if (revision.platformFile.status !== 'READY') {
      throw new BadRequestException(
        'This revision has no uploaded file yet. Upload the document before issuing it.',
      );
    }
    const purpose = dto.purpose ?? revision.purpose;
    assertPurposeAllowed(document.category, purpose);
    const revisionCode = dto.revisionCode !== undefined
      ? normaliseRevisionCode(dto.revisionCode)
      : revision.revisionCode;
    const issuedAt = this.parseDate(dto.issuedAt) ?? new Date();

    await prisma.$transaction(async (tx) => {
      const previous =
        document.currentRevisionId && document.currentRevisionId !== revisionId
          ? await this.repo.findIssuedRevision(tx, document.currentRevisionId)
          : null;

      // Supersede FIRST. The one-ISSUED-revision partial index would otherwise reject the promote,
      // and a rejection here is the right outcome for a race but the wrong outcome for the
      // ordinary path.
      if (previous) {
        await this.repo.updateRevision(tx, previous.id, {
          status: 'SUPERSEDED',
          supersededAt: issuedAt,
        });
      }

      await this.repo.updateRevision(tx, revisionId, {
        status: 'ISSUED',
        issuedAt,
        issuedBy: identity.userId,
        revisionCode,
        purpose,
      });

      await this.repo.updateDocument(tx, documentId, {
        currentRevision: { connect: { id: revisionId } },
        // The document's own issue date is the first issue, not the latest — it is when this
        // controlled record entered service. Later revisions carry their own dates.
        ...(document.status === 'DRAFT'
          ? { status: 'ISSUED', issuedAt: document.issuedAt ?? issuedAt }
          : {}),
      });

      await this.audit(tx, identity, {
        action: 'ISSUE',
        resourceType: 'ProjectDocumentRevision',
        resourceId: revisionId,
        sourceCommand: 'projectDocument.issueRevision',
        eventType: 'PROJECT_DOCUMENT_REVISION_ISSUED',
        idempotencyKey: `project-document-revision-issue-${revisionId}`,
        before: { status: 'DRAFT', documentStatus: document.status },
        after: {
          status: 'ISSUED',
          revisionNumber: revision.revisionNumber,
          revisionCode,
          purpose: purpose ?? null,
          issuedAt: issuedAt.toISOString(),
          supersededRevisionId: previous?.id ?? null,
        },
      });
    });

    // From here this file is part of the record. A correction appends a new revision; it never
    // replaces this one. The superseded revision's file was already IMMUTABLE from its own issue.
    await this.files.markImmutable(
      revision.platformFileId,
      `issued revision ${revision.revisionNumber} of document ${documentId}`,
    );
    return this.findOne(identity, projectId, documentId);
  }

  async withdraw(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
    dto: WithdrawDocumentDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const document = await this.requireDocument(projectId, documentId, identity);
    assertWithdrawable(document.status);
    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('Give a reason for withdrawing this document.');

    await this.tenancy.getClient().$transaction(async (tx) => {
      await this.repo.updateDocument(tx, documentId, {
        status: 'WITHDRAWN',
        withdrawnAt: new Date(),
        withdrawnBy: identity.userId,
        withdrawnReason: reason,
      });
      // The current revision is withdrawn with it: the site must not be able to open a document
      // marked withdrawn and still find a revision labelled current.
      if (document.currentRevisionId) {
        await this.repo.updateRevision(tx, document.currentRevisionId, {
          status: 'WITHDRAWN',
          withdrawnAt: new Date(),
          withdrawnBy: identity.userId,
        });
      }
      await this.audit(tx, identity, {
        action: 'WITHDRAW',
        resourceType: 'ProjectDocument',
        resourceId: documentId,
        sourceCommand: 'projectDocument.withdraw',
        eventType: 'PROJECT_DOCUMENT_WITHDRAWN',
        idempotencyKey: `project-document-withdraw-${documentId}`,
        before: { status: document.status },
        after: { status: 'WITHDRAWN' },
        reason,
      });
    });
    return this.findOne(identity, projectId, documentId);
  }

  async archive(identity: RequestIdentity, projectId: string, documentId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const document = await this.requireDocument(projectId, documentId, identity);
    assertArchivable(document.status);

    await this.tenancy.getClient().$transaction(async (tx) => {
      await this.repo.updateDocument(tx, documentId, {
        status: 'ARCHIVED',
        archivedAt: new Date(),
        archivedBy: identity.userId,
      });
      await this.audit(tx, identity, {
        action: 'ARCHIVE',
        resourceType: 'ProjectDocument',
        resourceId: documentId,
        sourceCommand: 'projectDocument.archive',
        eventType: 'PROJECT_DOCUMENT_ARCHIVED',
        idempotencyKey: `project-document-archive-${documentId}`,
        before: { status: document.status },
        after: { status: 'ARCHIVED' },
      });
    });
    return this.findOne(identity, projectId, documentId);
  }

  /**
   * Replace this whole controlled record with another one — a renewed permit, a reissued licence.
   *
   * Distinct from revision supersession, which replaces an *issue* of the same document. This one
   * needs a target, and the target must be an issued document in the same project, so the status
   * is never a dead end the reader cannot follow.
   */
  async supersede(
    identity: RequestIdentity,
    projectId: string,
    documentId: string,
    dto: SupersedeDocumentDto,
  ) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const document = await this.requireDocument(projectId, documentId, identity);

    if (dto.supersededByDocumentId === documentId) {
      throw new BadRequestException('A document cannot supersede itself.');
    }
    const successor = await this.repo.findInProject(
      prisma,
      identity.activeOrganizationId,
      projectId,
      dto.supersededByDocumentId,
    );
    if (!successor) {
      throw new NotFoundException('The replacement document was not found on this project.');
    }
    assertSupersedable(document.status, successor.status);

    await prisma.$transaction(async (tx) => {
      await this.repo.updateDocument(tx, documentId, {
        status: 'SUPERSEDED',
        supersededAt: new Date(),
        supersededBy: { connect: { id: successor.id } },
      });
      await this.audit(tx, identity, {
        action: 'SUPERSEDE',
        resourceType: 'ProjectDocument',
        resourceId: documentId,
        sourceCommand: 'projectDocument.supersede',
        eventType: 'PROJECT_DOCUMENT_SUPERSEDED',
        idempotencyKey: `project-document-supersede-${documentId}`,
        before: { status: document.status },
        after: { status: 'SUPERSEDED', supersededByDocumentId: successor.id },
      });
    });
    return this.findOne(identity, projectId, documentId);
  }

  /**
   * Discard a draft that was never issued.
   *
   * The only destructive operation the register has, and it is deliberately unreachable for
   * anything with history: `assertDeletable` refuses a document that is not DRAFT and refuses a
   * DRAFT that has any non-draft revision behind it. Its files are discarded with it, which is the
   * half the old implementation was missing.
   */
  async remove(identity: RequestIdentity, projectId: string, documentId: string) {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const document = await this.requireDocument(projectId, documentId, identity);

    const revisions = await this.repo.findRevisionStatuses(prisma, documentId);
    assertDeletable(document.status, revisions.map((r) => r.status as DocumentRevisionStatus));

    await prisma.$transaction(async (tx) => {
      // Current-revision FK first: the document points at a revision that cascades from it, so
      // clearing the pointer is what lets the delete through.
      await this.repo.setCurrentRevision(tx, documentId, null);
      await this.repo.deleteDocument(tx, documentId);
      await this.audit(tx, identity, {
        action: 'DELETE',
        resourceType: 'ProjectDocument',
        resourceId: documentId,
        sourceCommand: 'projectDocument.remove',
        eventType: 'PROJECT_DOCUMENT_DISCARDED',
        idempotencyKey: `project-document-delete-${documentId}`,
        before: {
          documentNumber: document.documentNumber,
          title: document.title,
          status: document.status,
        },
      });
    });

    for (const revision of revisions) {
      await this.files.discardIfUnreferenced(revision.platformFileId);
    }
    return { id: documentId, deleted: true };
  }

  // --- helpers -------------------------------------------------------------------------------

  private async requireDocument(
    projectId: string,
    documentId: string,
    identity: RequestIdentity,
  ): Promise<DocumentRow> {
    const document = await this.repo.findOne(
      this.tenancy.getClient(),
      identity.activeOrganizationId,
      projectId,
      documentId,
    );
    if (!document) throw new NotFoundException(`Document ${documentId} not found`);
    return document;
  }

  /**
   * A file may be claimed by exactly one record.
   *
   * Sharing bytes across two records would make one record's deletion break the other, and would
   * make "is this file immutable?" a question with two different right answers. The caller uploads
   * twice instead, and each copy then has its own lifecycle.
   */
  private async assertFileAttachable(organizationId: string, fileId: string, userId: string) {
    const file = await this.repo.findFileStatus(this.tenancy.getClient(), organizationId, fileId);
    if (!file) throw new NotFoundException(`File ${fileId} not found`);
    if (file.status !== 'READY') {
      throw new BadRequestException('The file must be fully uploaded before it can be registered.');
    }
    if (file.lifecycle !== 'TEMPORARY') {
      throw new BadRequestException('That file is already attached to a record.');
    }
    if (file.uploadedBy !== userId) {
      throw new ForbiddenException('You can only register a file that you uploaded.');
    }
  }

  /**
   * The responsible person must be a member of the project.
   *
   * Accountability without access is a name on a screen: someone who cannot open the document
   * cannot keep it current. Refused rather than silently accepted, because a register that lets a
   * document be assigned to someone who cannot act on it has moved the problem, not solved it.
   */
  private async resolveResponsible(
    projectId: string,
    userId: string | null | undefined,
  ): Promise<string | null> {
    if (!userId) return null;
    const member = await this.repo.findProjectMember(this.tenancy.getClient(), projectId, userId);
    if (!member) {
      throw new BadRequestException(
        'The responsible person must be a member of this project. Add them to the team first.',
      );
    }
    return userId;
  }

  private parseDate(value: string | null | undefined): Date | null {
    if (value === null || value === undefined || value === '') return null;
    // Date-only strings are anchored at UTC midnight so a document does not shift a day depending
    // on where the server is. The columns are `@db.Date`; the time is never meaningful.
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException(`"${value}" is not a valid date.`);
    return date;
  }

  private dateWindows() {
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const soonCutoff = new Date(today.getTime() + this.expiringSoonDays * MS_PER_DAY);
    return { today, soonCutoff };
  }

  /**
   * A validity filter is a filter over a derived value, so it becomes a date window here rather
   * than a column comparison. `requireExpiry` is what stops "valid" quietly including every
   * drawing that has no expiry date at all — a different fact, with a different state.
   */
  private validityWindow(validity: string | undefined, today: Date, soonCutoff: Date) {
    switch (validity) {
      case DocumentValidity.EXPIRED:
        return { requireExpiry: true, expiresBefore: today };
      case DocumentValidity.EXPIRING_SOON:
        return { requireExpiry: true, expiresFrom: today, expiresBefore: soonCutoff };
      case DocumentValidity.VALID:
        return { requireExpiry: true, expiresFrom: soonCutoff };
      case DocumentValidity.NO_EXPIRY:
        return { noExpiry: true };
      // NOT_YET_VALID is derived from validFrom, not from expiry, so it gets its own window.
      case DocumentValidity.NOT_YET_VALID:
        return { validFromAfter: today };
      default:
        return {};
    }
  }

  private userIdsIn(rows: DocumentRow[]): string[] {
    return rows.flatMap((row) => [
      row.createdBy,
      row.responsibleUserId ?? '',
      row.currentRevision?.createdBy ?? '',
      row.currentRevision?.issuedBy ?? '',
    ]);
  }

  private metadataEventType(fields: string[]): string {
    if (fields.includes('responsibleUserId')) return 'PROJECT_DOCUMENT_RESPONSIBLE_CHANGED';
    if (fields.includes('expiresAt') || fields.includes('validFrom')) {
      return 'PROJECT_DOCUMENT_VALIDITY_CHANGED';
    }
    return 'PROJECT_DOCUMENT_UPDATED';
  }

  private audit(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    command: {
      action: string;
      resourceType: string;
      resourceId: string;
      sourceCommand: string;
      eventType: string;
      idempotencyKey: string;
      before?: Record<string, unknown>;
      after?: Record<string, unknown>;
      reason?: string;
    },
  ) {
    return this.auditOutbox.record(tx, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      ...command,
    });
  }

  // --- read-model mapping --------------------------------------------------------------------

  private toDocumentResponse(row: DocumentRow, names: Map<string, string>): ProjectDocumentResponse {
    const { validity, daysUntilExpiry } = deriveValidity(
      { validFrom: row.validFrom, expiresAt: row.expiresAt },
      new Date(),
      this.expiringSoonDays,
    );
    return {
      id: row.id,
      projectId: row.projectId,
      documentNumber: row.documentNumber,
      title: row.title,
      category: row.category,
      discipline: row.discipline,
      status: row.status as `${PrismaDocumentStatus}`,
      responsibleUserId: row.responsibleUserId,
      responsibleUserName: row.responsibleUserId
        ? (names.get(row.responsibleUserId) ?? null)
        : null,
      issuerName: row.issuerName,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      validFrom: row.validFrom?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      validity,
      daysUntilExpiry,
      revisionCount: row._count.revisions,
      currentRevision: row.currentRevision
        ? this.toRevisionResponse(row.currentRevision, row.currentRevisionId, names)
        : null,
      supersededByDocumentId: row.supersededByDocumentId,
      supersededByDocumentNumber: row.supersededBy?.documentNumber ?? null,
      withdrawnReason: row.withdrawnReason,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toRevisionResponse(
    row: RevisionRow,
    currentRevisionId: string | null,
    names: Map<string, string>,
  ): DocumentRevisionResponse {
    return {
      id: row.id,
      projectDocumentId: row.projectDocumentId,
      revisionNumber: row.revisionNumber,
      revisionCode: row.revisionCode,
      status: row.status,
      purpose: row.purpose as `${DocumentRevisionPurpose}` | null,
      notes: row.notes,
      issuedAt: row.issuedAt?.toISOString() ?? null,
      issuedBy: row.issuedBy,
      issuedByName: row.issuedBy ? (names.get(row.issuedBy) ?? null) : null,
      supersededAt: row.supersededAt?.toISOString() ?? null,
      withdrawnAt: row.withdrawnAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdByName: names.get(row.createdBy) ?? null,
      createdAt: row.createdAt.toISOString(),
      file: {
        id: row.platformFile.id,
        originalName: row.platformFile.originalName,
        mimeType: row.platformFile.mimeType,
        sizeBytes: row.platformFile.sizeBytes,
        status: row.platformFile.status,
        lifecycle: row.platformFile.lifecycle,
      },
      isCurrent: row.id === currentRevisionId,
    };
  }
}

// Re-exported so the controller can gate on the same predicates the service enforces, rather than
// re-deriving "is this editable" from a status string in a second place.
export { isEditableDocumentStatus, isTerminalDocumentStatus };
