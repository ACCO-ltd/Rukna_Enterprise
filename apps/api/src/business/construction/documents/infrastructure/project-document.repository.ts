import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  DocumentCategory,
  DocumentDiscipline,
  DocumentRevisionPurpose,
  DocumentRevisionStatus,
  ProjectDocumentStatus,
} from '@prisma/client';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/** Everything a register row and a detail page render, in one shape. */
const DOCUMENT_INCLUDE = {
  currentRevision: { include: { platformFile: true } },
  supersededBy: { select: { id: true, documentNumber: true } },
  _count: { select: { revisions: true } },
} satisfies Prisma.ProjectDocumentInclude;

export type DocumentRow = Prisma.ProjectDocumentGetPayload<{ include: typeof DOCUMENT_INCLUDE }>;

const REVISION_INCLUDE = { platformFile: true } satisfies Prisma.ProjectDocumentRevisionInclude;
export type RevisionRow = Prisma.ProjectDocumentRevisionGetPayload<{
  include: typeof REVISION_INCLUDE;
}>;

export interface DocumentFilters {
  search?: string;
  category?: DocumentCategory;
  discipline?: DocumentDiscipline;
  status?: ProjectDocumentStatus;
  responsibleUserId?: string;
  /** Resolved to a date window by the service — validity is derived, so it cannot be a column. */
  expiresBefore?: Date;
  expiresFrom?: Date;
  requireExpiry?: boolean;
  /** The NO_EXPIRY filter: documents with no expiry date at all, which is its own fact. */
  noExpiry?: boolean;
  /** The NOT_YET_VALID filter — derived from validFrom, not from expiry. */
  validFromAfter?: Date;
  page: number;
  pageSize: number;
}

export interface CreateDocumentData {
  organizationId: string;
  projectId: string;
  documentNumber: string;
  documentNumberNormalized: string;
  title: string;
  category: DocumentCategory;
  discipline: DocumentDiscipline | null;
  responsibleUserId: string | null;
  issuerName: string | null;
  issuedAt: Date | null;
  validFrom: Date | null;
  expiresAt: Date | null;
  createdBy: string;
}

export interface CreateRevisionData {
  organizationId: string;
  projectDocumentId: string;
  platformFileId: string;
  revisionNumber: number;
  revisionCode: string | null;
  purpose: DocumentRevisionPurpose | null;
  notes: string | null;
  createdBy: string;
}

@Injectable()
export class ProjectDocumentRepository {
  // --- reads -------------------------------------------------------------------------------

  /**
   * The register page.
   *
   * Search covers document number, title and revision code, because those are the three things a
   * person actually has in front of them when they come looking — a drawing number off a print, a
   * title from an email, a revision from a transmittal.
   */
  async findPage(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    filters: DocumentFilters,
  ): Promise<{ items: DocumentRow[]; total: number }> {
    const where = this.buildWhere(organizationId, projectId, filters);
    const [items, total] = await Promise.all([
      prisma.projectDocument.findMany({
        where,
        include: DOCUMENT_INCLUDE,
        // Attention first is tempting and wrong: a register is a reference, and a reference whose
        // row order changes as dates pass cannot be scanned twice the same way. Newest first,
        // with the attention states carried by the validity column and the summary counts.
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
      prisma.projectDocument.count({ where }),
    ]);
    return { items, total };
  }

  private buildWhere(
    organizationId: string,
    projectId: string,
    filters: DocumentFilters,
  ): Prisma.ProjectDocumentWhereInput {
    const where: Prisma.ProjectDocumentWhereInput = { organizationId, projectId };

    if (filters.search) {
      const search = filters.search.trim();
      where.OR = [
        { documentNumber: { contains: search, mode: 'insensitive' } },
        { title: { contains: search, mode: 'insensitive' } },
        { revisions: { some: { revisionCode: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    if (filters.category) where.category = filters.category;
    if (filters.discipline) where.discipline = filters.discipline;
    if (filters.status) where.status = filters.status;
    if (filters.responsibleUserId) where.responsibleUserId = filters.responsibleUserId;

    // Validity is derived, so it is filtered as the date window that produces it. `requireExpiry`
    // is what keeps NO_EXPIRY documents out of an expiry filter — without it, "not expired" would
    // silently include every drawing that has no expiry date at all.
    if (filters.validFromAfter) where.validFrom = { gt: filters.validFromAfter };
    if (filters.noExpiry) where.expiresAt = null;
    if (filters.requireExpiry) where.expiresAt = { not: null };
    if (filters.expiresBefore || filters.expiresFrom) {
      where.expiresAt = {
        ...(filters.expiresFrom ? { gte: filters.expiresFrom } : {}),
        ...(filters.expiresBefore ? { lt: filters.expiresBefore } : {}),
      };
    }
    return where;
  }

  findOne(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    id: string,
  ): Promise<DocumentRow | null> {
    return prisma.projectDocument.findFirst({
      where: { id, organizationId, projectId },
      include: DOCUMENT_INCLUDE,
    });
  }

  /** Cross-project reads are refused upstream; this exists for the supersede successor lookup. */
  findInProject(prisma: TenantPrisma, organizationId: string, projectId: string, id: string) {
    return prisma.projectDocument.findFirst({
      where: { id, organizationId, projectId },
      select: { id: true, documentNumber: true, status: true },
    });
  }

  findRevisions(prisma: TenantPrisma, projectDocumentId: string): Promise<RevisionRow[]> {
    return prisma.projectDocumentRevision.findMany({
      where: { projectDocumentId },
      include: REVISION_INCLUDE,
      orderBy: { revisionNumber: 'desc' },
    });
  }

  findRevision(
    prisma: TenantPrisma,
    organizationId: string,
    projectDocumentId: string,
    revisionId: string,
  ): Promise<RevisionRow | null> {
    return prisma.projectDocumentRevision.findFirst({
      where: { id: revisionId, organizationId, projectDocumentId },
      include: REVISION_INCLUDE,
    });
  }

  findRevisionStatuses(
    prisma: TenantPrisma,
    projectDocumentId: string,
  ): Promise<{ id: string; status: DocumentRevisionStatus; platformFileId: string }[]> {
    return prisma.projectDocumentRevision.findMany({
      where: { projectDocumentId },
      select: { id: true, status: true, platformFileId: true },
    });
  }

  findByNumber(
    prisma: TenantPrisma,
    projectId: string,
    documentNumberNormalized: string,
  ): Promise<{ id: string } | null> {
    return prisma.projectDocument.findFirst({
      where: { projectId, documentNumberNormalized },
      select: { id: true },
    });
  }

  async nextRevisionNumber(prisma: TenantPrisma, projectDocumentId: string): Promise<number> {
    const highest = await prisma.projectDocumentRevision.aggregate({
      where: { projectDocumentId },
      _max: { revisionNumber: true },
    });
    return (highest._max.revisionNumber ?? 0) + 1;
  }

  /**
   * The register summary. Five counts, one round trip each, over the whole project rather than
   * the current page or the current filter — a control figure that moves when someone types in a
   * search box is not a control figure.
   *
   * `currentDrawings` counts drawings that have an issued current revision: a drawing still in
   * draft is not something the site can build from, so counting it would overstate what is
   * available.
   */
  async summaryCounts(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    today: Date,
    soonCutoff: Date,
  ) {
    const live: Prisma.ProjectDocumentWhereInput = {
      organizationId,
      projectId,
      status: { notIn: ['ARCHIVED', 'SUPERSEDED'] },
    };

    const [controlledDocuments, currentDrawings, expiringSoon, expired, draft] = await Promise.all([
      prisma.projectDocument.count({ where: live }),
      prisma.projectDocument.count({
        where: { ...live, category: 'DRAWING', currentRevision: { status: 'ISSUED' } },
      }),
      prisma.projectDocument.count({
        where: { ...live, expiresAt: { gte: today, lte: soonCutoff } },
      }),
      prisma.projectDocument.count({ where: { ...live, expiresAt: { lt: today } } }),
      prisma.projectDocument.count({ where: { ...live, status: 'DRAFT' } }),
    ]);
    return { controlledDocuments, currentDrawings, expiringSoon, expired, draft };
  }

  /** Batch id -> "First Last". One query for the whole page, never one per row. */
  async resolveUserNames(
    prisma: TenantPrisma,
    organizationId: string,
    userIds: string[],
  ): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter(Boolean))];
    if (ids.length === 0) return new Map();
    const users = await prisma.user.findMany({
      where: { id: { in: ids }, organizationId },
      select: { id: true, firstName: true, lastName: true },
    });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));
  }

  /**
   * The document's own audit trail, read back out of the immutable log.
   *
   * Filtered to this aggregate's resource types so a project's other activity cannot leak in, and
   * to write commands only — a register that logged every download would bury the six events that
   * matter under a thousand that do not.
   */
  findActivity(
    prisma: TenantPrisma,
    organizationId: string,
    documentId: string,
    revisionIds: string[],
  ) {
    return prisma.auditLog.findMany({
      where: {
        orgId: organizationId,
        OR: [
          { resource: 'ProjectDocument', resourceId: documentId },
          ...(revisionIds.length
            ? [{ resource: 'ProjectDocumentRevision', resourceId: { in: revisionIds } }]
            : []),
        ],
      },
      select: {
        id: true,
        action: true,
        sourceCommand: true,
        userId: true,
        reason: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Verify a file exists in this org and is attachable. Mirrors the DPR evidence check. */
  findFileStatus(prisma: TenantPrisma, organizationId: string, fileId: string) {
    return prisma.platformFile.findFirst({
      where: { id: fileId, organizationId },
      select: { id: true, status: true, lifecycle: true, uploadedBy: true },
    });
  }

  /** Membership check for the responsible person — accountability requires project access. */
  findProjectMember(prisma: TenantPrisma, projectId: string, userId: string) {
    return prisma.projectMember.findFirst({
      where: { projectId, userId, removedAt: null },
      select: { id: true },
    });
  }

  // --- writes ------------------------------------------------------------------------------

  createDocument(tx: Prisma.TransactionClient, data: CreateDocumentData) {
    return tx.projectDocument.create({ data });
  }

  /** The revision a document currently points at, only if it is still ISSUED. Read inside the
   *  issue transaction, so it must take the transaction client rather than the tenant client. */
  findIssuedRevision(tx: Prisma.TransactionClient, revisionId: string) {
    return tx.projectDocumentRevision.findFirst({
      where: { id: revisionId, status: 'ISSUED' },
      select: { id: true },
    });
  }

  createRevision(tx: Prisma.TransactionClient, data: CreateRevisionData) {
    return tx.projectDocumentRevision.create({ data });
  }

  setCurrentRevision(tx: Prisma.TransactionClient, documentId: string, revisionId: string | null) {
    return tx.projectDocument.update({
      where: { id: documentId },
      data: { currentRevisionId: revisionId },
    });
  }

  updateDocument(
    tx: Prisma.TransactionClient,
    documentId: string,
    data: Prisma.ProjectDocumentUpdateInput,
  ) {
    return tx.projectDocument.update({ where: { id: documentId }, data });
  }

  updateRevision(
    tx: Prisma.TransactionClient,
    revisionId: string,
    data: Prisma.ProjectDocumentRevisionUpdateInput,
  ) {
    return tx.projectDocumentRevision.update({ where: { id: revisionId }, data });
  }

  deleteDocument(tx: Prisma.TransactionClient, documentId: string) {
    return tx.projectDocument.delete({ where: { id: documentId } });
  }
}
