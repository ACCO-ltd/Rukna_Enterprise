import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';

import type { LinkedPurchaseOrderFacts } from '../domain/quotation-state.policy.js';

/** A tenant client or an interactive-transaction client. */
export type Db = Prisma.TransactionClient | PrismaClient;

export const REQUEST_INCLUDE = {
  quotes: {
    include: {
      photos: { orderBy: { pageNumber: 'asc' as const } },
      supplier: { select: { id: true, code: true, name: true, status: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.QuotationRequestInclude;

export type QuotationRequestAggregate = Prisma.QuotationRequestGetPayload<{ include: typeof REQUEST_INCLUDE }>;

export const MR_INCLUDE = {
  lines: {
    include: { uom: { select: { code: true, name: true } }, material: { select: { defaultSpendCategoryId: true } } },
    orderBy: { lineNumber: 'asc' as const },
  },
} satisfies Prisma.MaterialRequestInclude;

export type MaterialRequestForQuotation = Prisma.MaterialRequestGetPayload<{ include: typeof MR_INCLUDE }>;

/** Accepted photo formats (ADR-044 Q3) and the per-photo size cap. */
export const QUOTE_PHOTO_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'] as const;
export const QUOTE_PHOTO_MAX_BYTES = 8 * 1024 * 1024;

@Injectable()
export class QuotationRequestRepository {
  findById(db: Db, organizationId: string, id: string): Promise<QuotationRequestAggregate | null> {
    return db.quotationRequest.findFirst({ where: { id, organizationId }, include: REQUEST_INCLUDE });
  }

  /**
   * Takes the request's row lock (`SELECT … FOR UPDATE`) inside `tx`, then reads the aggregate. Every
   * command runs under this lock, so two commands on one request serialise and each re-checks the
   * state it acts on. Null for an unknown or foreign id.
   */
  async lockById(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM quotation_requests WHERE id = ${id} AND organization_id = ${organizationId} FOR UPDATE`;
    if (rows.length === 0) return null;
    return this.findById(tx, organizationId, id);
  }

  /** The MR's live round: not cancelled and not closed (review M1). At most one (partial index). */
  findLiveForMaterialRequest(db: Db, organizationId: string, materialRequestId: string) {
    return db.quotationRequest.findFirst({
      where: { organizationId, materialRequestId, status: { not: 'CANCELLED' }, closedAt: null },
      include: REQUEST_INCLUDE,
    });
  }

  /** Closed rounds of the MR (their award's order was confirmed), with that order's status. */
  findClosedRoundsForMaterialRequest(db: Db, organizationId: string, materialRequestId: string) {
    return db.quotationRequest.findMany({
      where: { organizationId, materialRequestId, status: { not: 'CANCELLED' }, closedAt: { not: null } },
      select: { id: true, number: true, purchaseOrder: { select: { status: true } } },
    });
  }

  /** Serialises opens on one MR (the partial unique index is the backstop). */
  async lockMaterialRequest(tx: Prisma.TransactionClient, organizationId: string, materialRequestId: string) {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id FROM material_requests WHERE id = ${materialRequestId} AND organization_id = ${organizationId} FOR UPDATE`;
    return rows.length > 0;
  }

  findMaterialRequest(db: Db, organizationId: string, id: string): Promise<MaterialRequestForQuotation | null> {
    return db.materialRequest.findFirst({ where: { id, organizationId }, include: MR_INCLUDE });
  }

  /** QR-00001: per-org sequence, serialised by a transaction-scoped advisory lock. */
  async nextNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quotation-number:${organizationId}`}))`;
    const count = await tx.quotationRequest.count({ where: { organizationId } });
    return `QR-${String(count + 1).padStart(5, '0')}`;
  }

  /** QS-00001: per-org code sequence for suppliers registered from a quotation award. */
  async nextQuotationSupplierCode(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quotation-supplier-code:${organizationId}`}))`;
    const rows = await tx.$queryRaw<Array<{ max: number | null }>>`
      SELECT MAX(CAST(SUBSTRING(code FROM 4) AS INTEGER)) AS max
        FROM suppliers
       WHERE organization_id = ${organizationId} AND code ~ '^QS-[0-9]+$'`;
    return `QS-${String((rows[0]?.max ?? 0) + 1).padStart(5, '0')}`;
  }

  findQuoteByClientRef(db: Db, quotationRequestId: string, clientRef: string) {
    return db.quote.findUnique({
      where: { quotationRequestId_clientRef: { quotationRequestId, clientRef } },
      select: { id: true, photos: { select: { platformFileId: true } } },
    });
  }

  /** Registered suppliers in the org whose name normalises to `normalised`. */
  findSuppliersByNormalisedName(db: Db, organizationId: string, normalised: string[]) {
    if (normalised.length === 0) return Promise.resolve([] as Array<{ id: string; code: string; name: string; norm: string }>);
    return db.$queryRaw<Array<{ id: string; code: string; name: string; norm: string }>>`
      SELECT id, code, name, lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) AS norm
        FROM suppliers
       WHERE organization_id = ${organizationId}
         AND status = 'ACTIVE'
         AND lower(regexp_replace(btrim(name), '\\s+', ' ', 'g')) = ANY(${normalised})
       ORDER BY name`;
  }

  findSupplier(db: Db, organizationId: string, id: string) {
    return db.supplier.findFirst({
      where: { id, organizationId },
      select: { id: true, code: true, name: true, status: true, createdBy: true },
    });
  }

  findFile(db: Db, organizationId: string, id: string) {
    return db.platformFile.findFirst({
      where: { id, organizationId },
      select: {
        id: true,
        status: true,
        lifecycle: true,
        uploadedBy: true,
        mimeType: true,
        sizeBytes: true,
        checksumSha256: true,
      },
    });
  }

  /** TEMPORARY → BOUND for the uploader's READY file, as a compare-and-set. False when it lost a race. */
  async bindFile(db: Db, organizationId: string, fileId: string, uploadedBy: string, reason: string) {
    const { count } = await db.platformFile.updateMany({
      where: { id: fileId, organizationId, status: 'READY', lifecycle: 'TEMPORARY', uploadedBy },
      data: { lifecycle: 'BOUND', boundAt: new Date(), lifecycleReason: reason.slice(0, 120) },
    });
    return count === 1;
  }

  /** Every photo of every ACTIVE quote → IMMUTABLE (ADR-044 §4 invariant 2). Idempotent. */
  async freezeActivePhotos(db: Db, quotationRequestId: string, reason: string) {
    const photos = await db.quotePhoto.findMany({
      where: { quote: { quotationRequestId, status: 'ACTIVE' } },
      select: { platformFileId: true },
    });
    if (photos.length === 0) return 0;
    const { count } = await db.platformFile.updateMany({
      where: { id: { in: photos.map((p) => p.platformFileId) }, lifecycle: { not: 'IMMUTABLE' } },
      data: { lifecycle: 'IMMUTABLE', lifecycleReason: reason.slice(0, 120) },
    });
    return count;
  }

  /** The PO raised from the award, as the state machine sees it; null when none is linked. */
  async linkedPurchaseOrder(db: Db, purchaseOrderId: string | null): Promise<LinkedPurchaseOrderFacts | null> {
    if (!purchaseOrderId) return null;
    const po = await db.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      select: { status: true, revisions: { select: { status: true, approvedAt: true } } },
    });
    if (!po) return null;
    return {
      status: po.status,
      everConfirmed: po.revisions.some(
        (r) => r.approvedAt !== null || r.status === 'ACTIVE' || r.status === 'SUPERSEDED',
      ),
    };
  }

  /** Requests (other than `exceptRequestId`) in the org holding a photo with one of `hashes`. */
  async findPhotoReuse(db: Db, organizationId: string, hashes: string[], exceptRequestId: string) {
    if (hashes.length === 0) return new Map<string, string[]>();
    const rows = await db.quotePhoto.findMany({
      where: {
        organizationId,
        sha256: { in: hashes },
        quote: { quotationRequestId: { not: exceptRequestId } },
      },
      select: { sha256: true, quote: { select: { quotationRequest: { select: { number: true } } } } },
    });
    const reuse = new Map<string, string[]>();
    for (const row of rows) {
      const list = reuse.get(row.sha256) ?? [];
      const number = row.quote.quotationRequest.number;
      if (!list.includes(number)) list.push(number);
      reuse.set(row.sha256, list.sort());
    }
    return reuse;
  }
}
