import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { REQUEST_INCLUDE, type Db } from '../../quotations/infrastructure/quotation-request.repository.js';

const DOC_INCLUDE = { photos: { orderBy: { pageNumber: 'asc' } } } satisfies Prisma.StoreDocumentInclude;

@Injectable()
export class StoreDocumentRepository {
  /** SD-00001: per-org sequence, serialised by a transaction-scoped advisory lock. */
  async nextNumber(tx: Prisma.TransactionClient, organizationId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`store-document-number:${organizationId}`}))`;
    const count = await tx.storeDocument.count({ where: { organizationId } });
    return `SD-${String(count + 1).padStart(5, '0')}`;
  }

  findByClientRef(db: Db, organizationId: string, clientRef: string) {
    return db.storeDocument.findUnique({
      where: { organizationId_clientRef: { organizationId, clientRef } },
      include: DOC_INCLUDE,
    });
  }

  findById(db: Db, organizationId: string, id: string) {
    return db.storeDocument.findFirst({ where: { id, organizationId }, include: DOC_INCLUDE });
  }

  async lockById(tx: Prisma.TransactionClient, organizationId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM store_documents WHERE id = ${id} AND organization_id = ${organizationId} FOR UPDATE`;
    return this.findById(tx, organizationId, id);
  }

  findForPurchaseOrder(db: Db, organizationId: string, purchaseOrderId: string) {
    return db.storeDocument.findMany({
      where: { organizationId, purchaseOrderId },
      include: DOC_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /** The award (with its quotes and photos, for the collector check) a purchase order was raised from. */
  findAwardForPurchaseOrder(db: Db, organizationId: string, purchaseOrderId: string) {
    return db.quotationRequest.findFirst({
      where: { organizationId, purchaseOrderId },
      include: { ...REQUEST_INCLUDE, purchaseOrder: { select: { id: true, status: true } } },
    });
  }

  /** R12 — is this photo hash already on a live (SUBMITTED / RECORDED) store document of the org? */
  async liveHashExists(db: Db, organizationId: string, sha256: string): Promise<boolean> {
    const hit = await db.storeDocumentPhoto.findFirst({
      where: { organizationId, sha256, isLive: true },
      select: { id: true },
    });
    return hit !== null;
  }
}
