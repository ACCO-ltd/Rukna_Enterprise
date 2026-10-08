import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { canSeeQuotationPhotos } from '../../../../platform/files/application/file-authorization.service.js';
import { loadActorNames } from '../../../../platform/users/application/actor-names.js';
import { QUOTE_PHOTO_MAX_BYTES, QUOTE_PHOTO_MIME_TYPES } from '../../quotations/infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from '../../quotations/application/quotation-access.service.js';
import { QuotationPaymentNotifier, type StoreDocumentRef } from '../../quotations/application/quotation-payment-notifier.service.js';
import { quotationBadRequest, quotationConflict, quotationForbidden } from '../../quotations/domain/quotation-errors.js';
import { StoreDocumentRepository } from '../infrastructure/store-document.repository.js';

export type StoreDocumentKindInput = 'RECEIPT' | 'INVOICE';
export type StoreDocumentRejectReasonInput = 'ILLEGIBLE' | 'WRONG_PO' | 'DUPLICATE' | 'OTHER';

export interface StoreDocumentPhotoInput {
  platformFileId: string;
  capturedAt: string;
  source: 'CAMERA' | 'GALLERY' | 'UNKNOWN';
}

export interface CreateStoreDocumentInput {
  clientRef: string;
  purchaseOrderId: string;
  kind: StoreDocumentKindInput;
  photos: StoreDocumentPhotoInput[];
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

const MESSAGES: Record<string, string> = {
  STORE_DOCUMENT_NOT_AWARD_PO: 'Receipts can only be sent for an issued purchase order raised from an award.',
  STORE_DOCUMENT_NOT_COLLECTOR: 'Only a collector of this award can send its receipt.',
  STORE_DOCUMENT_NOT_UPLOADER: 'Only the person who sent this receipt can change it.',
  STORE_DOCUMENT_NOT_SUBMITTED: 'This receipt is no longer waiting to be recorded.',
  STORE_DOCUMENT_PHOTO_DUPLICATE: 'This receipt photo was already sent on another receipt.',
};
const conflict = (code: string) => quotationConflict(code, MESSAGES[code]);
const forbidden = (code: string) => quotationForbidden(code, MESSAGES[code]);

/**
 * ADR-045 §2 — the store's paper receipt / invoice, photographed by the buyer (no amount typed —
 * ADR-044 principle 2). Capture reuses the Phase 1 photo rules: the caller's own READY, TEMPORARY
 * image (jpeg/png/webp/heic ≤ 8 MB) with a SHA-256, bound TEMPORARY → BOUND as a compare-and-set.
 * A photo hash already on another live store document of the organisation is refused (a receipt
 * cannot be claimed twice). Finance records it into the bill (Accounts Payable) or rejects it here.
 */
@Injectable()
export class StoreDocumentService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: StoreDocumentRepository,
    private readonly access: QuotationAccessService,
    private readonly projectAccess: ProjectAccessService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly notifier: QuotationPaymentNotifier,
  ) {}

  /** S4 — idempotent on `clientRef` (the phone's upload queue). */
  async create(identity: RequestIdentity, input: CreateStoreDocumentInput) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    if (!input.photos?.length) throw quotationBadRequest('PHOTO_REQUIRED', 'A receipt needs at least one photo.');

    const replay = await this.repo.findByClientRef(prisma, orgId, input.clientRef);
    if (replay) return this.replayOf(identity, replay, input);

    const award = await this.repo.findAwardForPurchaseOrder(prisma, orgId, input.purchaseOrderId);
    if (!award || award.status !== 'AWARDED' || award.purchaseOrder?.status !== 'OPEN') {
      if (!(await prisma.purchaseOrder.findFirst({ where: { id: input.purchaseOrderId, organizationId: orgId }, select: { id: true } }))) {
        throw new NotFoundException(`Purchase order ${input.purchaseOrderId} not found`);
      }
      throw conflict('STORE_DOCUMENT_NOT_AWARD_PO');
    }
    if (award.projectId) await this.projectAccess.assertMember(identity, award.projectId);
    if (!this.access.evidenceTouchers(award as never).includes(identity.userId)) throw forbidden('STORE_DOCUMENT_NOT_COLLECTOR');

    let id: string;
    try {
      id = await prisma.$transaction(async (tx) => {
        const number = await this.repo.nextNumber(tx, orgId);
        const doc = await tx.storeDocument.create({
          data: {
            organizationId: orgId,
            number,
            purchaseOrderId: input.purchaseOrderId,
            quotationRequestId: award.id,
            kind: input.kind,
            clientRef: input.clientRef,
            uploadedBy: identity.userId,
          },
        });
        const photos = await this.bindPhotos(tx, identity, doc.number, input.photos, 1);
        await tx.storeDocumentPhoto.createMany({ data: photos.map((p) => ({ ...p, storeDocumentId: doc.id })) });
        await this.audit(tx, identity, doc, 'STORE_DOCUMENT_SUBMITTED', 'store-document.create', {
          after: { number, kind: input.kind, purchaseOrderId: input.purchaseOrderId, photoFileIds: photos.map((p) => p.platformFileId) },
        });
        await this.notifier.receiptSubmitted(tx, this.ref(doc));
        return doc.id;
      });
    } catch (error) {
      // Two deliveries of one queued upload raced: the unique (org, clientRef) kept the first.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.repo.findByClientRef(prisma, orgId, input.clientRef);
        if (existing) return this.replayOf(identity, existing, input);
      }
      throw error;
    }
    return this.detail(identity, id);
  }

  /** Another page while the document waits (uploader only). */
  async addPhoto(identity: RequestIdentity, id: string, photo: StoreDocumentPhotoInput) {
    const prisma = this.tenancy.getClient();
    await prisma.$transaction(async (tx) => {
      const doc = await this.lockOwn(tx, identity, id);
      if (doc.photos.some((p) => p.platformFileId === photo.platformFileId)) return; // replay
      const next = Math.max(0, ...doc.photos.map((p) => p.pageNumber)) + 1;
      const [row] = await this.bindPhotos(tx, identity, doc.number, [photo], next);
      await tx.storeDocumentPhoto.create({ data: { ...row, storeDocumentId: doc.id } });
      await tx.storeDocument.update({ where: { id: doc.id }, data: { updatedAt: new Date() } });
      await this.audit(tx, identity, doc, 'STORE_DOCUMENT_PAGE_ADDED', 'store-document.add-photo', {
        after: { pageNumber: next, platformFileId: photo.platformFileId },
        keySuffix: photo.platformFileId,
      });
    });
    return this.detail(identity, id);
  }

  /** The uploader takes it back while it waits (wrong photo, wrong order). */
  async withdraw(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    await prisma.$transaction(async (tx) => {
      const doc = await this.lockOwn(tx, identity, id);
      await tx.storeDocument.update({ where: { id: doc.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } });
      await this.audit(tx, identity, doc, 'STORE_DOCUMENT_WITHDRAWN', 'store-document.withdraw', {
        before: { status: 'SUBMITTED' },
        after: { status: 'WITHDRAWN' },
      });
      await this.notifier.receiptWithdrawn(tx, this.ref(doc));
    });
    return this.detail(identity, id);
  }

  /** Finance refuses the receipt (illegible, wrong order, duplicate…); the buyer is told in-app. */
  async reject(identity: RequestIdentity, id: string, reason: 'ILLEGIBLE' | 'WRONG_PO' | 'DUPLICATE' | 'OTHER', note?: string) {
    const prisma = this.tenancy.getClient();
    const text = note?.trim() || null;
    if (reason === 'OTHER' && !text) throw quotationBadRequest('NOTE_REQUIRED', 'Say what is wrong with the receipt.');
    await prisma.$transaction(async (tx) => {
      const doc = await this.repo.lockById(tx, identity.activeOrganizationId, id);
      if (!doc) throw new NotFoundException(`Store document ${id} not found`);
      if (doc.status !== 'SUBMITTED') throw conflict('STORE_DOCUMENT_NOT_SUBMITTED');
      await tx.storeDocument.update({
        where: { id: doc.id },
        data: { status: 'REJECTED', rejectReason: reason, rejectNote: text, rejectedBy: identity.userId, rejectedAt: new Date() },
      });
      await this.audit(tx, identity, doc, 'STORE_DOCUMENT_REJECTED', 'store-document.reject', {
        before: { status: 'SUBMITTED' },
        after: { status: 'REJECTED', reason },
        reason: text ?? reason,
      });
      await this.notifier.receiptRejected(tx, this.ref(doc), reason);
    });
    return this.detail(identity, id);
  }

  /** `GET /procurement/store-documents?purchaseOrderId=` — photo ids only for those who may see them. */
  async list(identity: RequestIdentity, purchaseOrderId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const award = await this.repo.findAwardForPurchaseOrder(prisma, orgId, purchaseOrderId);
    if (award?.projectId) await this.projectAccess.assertMember(identity, award.projectId);
    const docs = await this.repo.findForPurchaseOrder(prisma, orgId, purchaseOrderId);
    return this.present(identity, docs);
  }

  async detail(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const doc = await this.repo.findById(prisma, identity.activeOrganizationId, id);
    if (!doc) throw new NotFoundException(`Store document ${id} not found`);
    const [row] = await this.present(identity, [doc]);
    return row;
  }

  async present(identity: RequestIdentity, docs: Awaited<ReturnType<StoreDocumentRepository['findForPurchaseOrder']>>) {
    const prisma = this.tenancy.getClient();
    const visible = canSeeQuotationPhotos(identity);
    const name = await loadActorNames(prisma, docs.flatMap((d) => [d.uploadedBy, d.rejectedBy ?? '']));
    return docs.map((d) => ({
      id: d.id,
      number: d.number,
      kind: d.kind,
      status: d.status,
      purchaseOrderId: d.purchaseOrderId,
      quotationRequestId: d.quotationRequestId,
      uploadedBy: { id: d.uploadedBy, name: name(d.uploadedBy) },
      uploadedByName: name(d.uploadedBy),
      createdAt: d.createdAt,
      supplierBillId: d.supplierBillId,
      documentDate: d.documentDate,
      recordedAt: d.recordedAt,
      rejectReason: d.rejectReason,
      rejectNote: d.rejectNote,
      rejectedAt: d.rejectedAt,
      photoCount: d.photos.length,
      photos: visible
        ? d.photos.map((p) => ({
            id: p.id,
            fileId: p.platformFileId,
            pageNumber: p.pageNumber,
            capturedAt: p.capturedAt,
            receivedAt: p.receivedAt,
            source: p.source,
            sha256: p.sha256,
          }))
        : [],
      photosVisible: visible,
    }));
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────

  private async replayOf(
    identity: RequestIdentity,
    existing: { id: string; uploadedBy: string; purchaseOrderId: string; photos: Array<{ platformFileId: string }> },
    input: CreateStoreDocumentInput,
  ) {
    const before = new Set(existing.photos.map((p) => p.platformFileId));
    const same =
      existing.uploadedBy === identity.userId &&
      existing.purchaseOrderId === input.purchaseOrderId &&
      input.photos.every((p) => before.has(p.platformFileId));
    if (!same) {
      throw quotationConflict(
        'CLIENT_REF_CONFLICT',
        'A different upload was already recorded under this upload key. Start a new receipt instead of retrying with other photos.',
      );
    }
    return this.detail(identity, existing.id);
  }

  private async lockOwn(tx: Prisma.TransactionClient, identity: RequestIdentity, id: string) {
    const doc = await this.repo.lockById(tx, identity.activeOrganizationId, id);
    if (!doc) throw new NotFoundException(`Store document ${id} not found`);
    if (doc.uploadedBy !== identity.userId) throw forbidden('STORE_DOCUMENT_NOT_UPLOADER');
    if (doc.status !== 'SUBMITTED') throw conflict('STORE_DOCUMENT_NOT_SUBMITTED');
    return doc;
  }

  /** The Phase 1 photo rules + the org-wide receipt duplicate check (R12); binds each file. */
  private async bindPhotos(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    number: string,
    photos: StoreDocumentPhotoInput[],
    firstPage: number,
  ) {
    const orgId = identity.activeOrganizationId;
    const rows: Array<Omit<Prisma.StoreDocumentPhotoUncheckedCreateInput, 'storeDocumentId'>> = [];
    const seen = new Set<string>();
    for (const [i, photo] of photos.entries()) {
      const file = await tx.platformFile.findFirst({
        where: { id: photo.platformFileId, organizationId: orgId },
        select: { id: true, status: true, lifecycle: true, uploadedBy: true, mimeType: true, sizeBytes: true, checksumSha256: true },
      });
      if (!file) throw new NotFoundException(`File ${photo.platformFileId} not found`);
      if (file.uploadedBy !== identity.userId) {
        throw new ForbiddenException({
          errorCode: 'FORBIDDEN',
          message: 'You can only attach a photo that you uploaded.',
          details: { code: 'FILE_NOT_ATTACHABLE' },
        });
      }
      if (file.status !== 'READY') throw quotationConflict('FILE_NOT_ATTACHABLE', 'The photo has not finished uploading.');
      if (file.lifecycle !== 'TEMPORARY') throw quotationConflict('FILE_NOT_ATTACHABLE', 'That photo is already attached to a record.');
      if (!(QUOTE_PHOTO_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
        throw quotationBadRequest('FILE_NOT_ATTACHABLE', 'A receipt photo must be a JPEG, PNG, WebP or HEIC image.');
      }
      if (file.sizeBytes > QUOTE_PHOTO_MAX_BYTES) throw quotationBadRequest('FILE_NOT_ATTACHABLE', 'A receipt photo is at most 8 MB.');
      const sha = file.checksumSha256?.toLowerCase() ?? '';
      if (!SHA256_HEX.test(sha)) throw quotationBadRequest('FILE_NOT_ATTACHABLE', 'The photo has no recorded checksum; upload it again.');
      if (seen.has(sha) || (await this.repo.liveHashExists(tx, orgId, sha))) throw conflict('STORE_DOCUMENT_PHOTO_DUPLICATE');
      seen.add(sha);
      const capturedAt = new Date(photo.capturedAt);
      if (Number.isNaN(capturedAt.getTime())) throw quotationBadRequest('CAPTURED_AT_INVALID', 'capturedAt must be an ISO date-time.');
      const { count } = await tx.platformFile.updateMany({
        where: { id: file.id, organizationId: orgId, status: 'READY', lifecycle: 'TEMPORARY', uploadedBy: identity.userId },
        data: { lifecycle: 'BOUND', boundAt: new Date(), lifecycleReason: `store document ${number}`.slice(0, 120) },
      });
      if (count !== 1) throw quotationConflict('FILE_NOT_ATTACHABLE', 'That photo is already attached to a record.');
      rows.push({
        organizationId: orgId,
        platformFileId: file.id,
        pageNumber: firstPage + i,
        sha256: sha,
        capturedAt,
        source: photo.source,
        uploadedBy: identity.userId,
      });
    }
    return rows;
  }

  private ref(doc: { id: string; number: string; organizationId: string; purchaseOrderId: string; quotationRequestId: string | null; uploadedBy: string }): StoreDocumentRef {
    return {
      id: doc.id,
      number: doc.number,
      organizationId: doc.organizationId,
      purchaseOrderId: doc.purchaseOrderId,
      quotationRequestId: doc.quotationRequestId,
      uploadedBy: doc.uploadedBy,
    };
  }

  private async audit(
    tx: Prisma.TransactionClient,
    identity: RequestIdentity,
    doc: { id: string; number: string },
    eventType: string,
    sourceCommand: string,
    extra: { before?: Record<string, unknown>; after?: Record<string, unknown>; reason?: string; keySuffix?: string },
  ) {
    const now = await tx.storeDocument.findUniqueOrThrow({ where: { id: doc.id }, select: { updatedAt: true } });
    await this.auditOutbox.record(tx, {
      organizationId: identity.activeOrganizationId,
      actorUserId: identity.userId,
      action: eventType === 'STORE_DOCUMENT_SUBMITTED' ? 'CREATE' : 'TRANSITION',
      resourceType: 'StoreDocument',
      resourceId: doc.id,
      sourceCommand,
      eventType,
      idempotencyKey: `store-document-${doc.id}-${eventType}${extra.keySuffix ? `-${extra.keySuffix}` : ''}-${now.updatedAt.getTime()}`,
      before: extra.before,
      after: { number: doc.number, ...(extra.after ?? {}) },
      reason: extra.reason,
    });
  }
}
