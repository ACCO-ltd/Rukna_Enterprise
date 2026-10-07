import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { PERMISSIONS, WorkflowTransactionType, type RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { TransactionalAuditOutboxService } from '../../../../platform/audit-logs/application/transactional-audit-outbox.service.js';
import { CommandGovernanceService } from '../../../../platform/workflows/application/command-governance.service.js';
import { PurchaseOrderRepository } from '../../purchase-orders/infrastructure/purchase-order.repository.js';
import {
  quotationBadRequest,
  quotationConflict,
  quotationForbidden,
} from '../domain/quotation-errors.js';
import { countBlock, distinctCount, normaliseStoreName, requiredCount, storeKey } from '../domain/quote-count.policy.js';
import {
  QUOTE_PHOTO_MAX_BYTES,
  QUOTE_PHOTO_MIME_TYPES,
  QuotationRequestRepository,
} from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationCommandRunner, type CommandContext } from './quotation-command-runner.service.js';
import { QuotationQueryService } from './quotation-query.service.js';
import { QuotationNotifier } from './quotation-notifier.service.js';

export type QuotePhotoSourceInput = 'CAMERA' | 'GALLERY' | 'UNKNOWN';

export interface QuotePhotoInput {
  platformFileId: string;
  capturedAt: string;
  source: QuotePhotoSourceInput;
}

export interface AddQuoteInput {
  clientRef: string;
  supplierId?: string;
  storeName?: string;
  /** Replacing a quote's photos: the old quote is WITHDRAWN and this one points at it. */
  replacesQuoteId?: string;
  photos: QuotePhotoInput[];
}

export type QuoteCountExceptionInput = 'ONLY_ONE_SUPPLIER' | 'URGENT' | 'FRAMEWORK_SUPPLIER';

const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * ADR-044 Q3 — the collector's commands: open a request on an approved MR, add quotes (photos only,
 * never a price) and pages, withdraw a quote, send to finance, reopen, cancel.
 */
@Injectable()
export class QuotationCollectService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly poRepo: PurchaseOrderRepository,
    private readonly access: QuotationAccessService,
    private readonly runner: QuotationCommandRunner,
    private readonly query: QuotationQueryService,
    private readonly auditOutbox: TransactionalAuditOutboxService,
    private readonly commandGovernance: CommandGovernanceService,
    private readonly notifier: QuotationNotifier,
  ) {}

  /**
   * S1 — open (or return) the live request for an APPROVED MR with nothing ordered yet. Repeat taps
   * and concurrent opens return the same request: opens on one MR serialise on the MR's row lock,
   * and the partial unique index is the backstop.
   */
  async open(identity: RequestIdentity, materialRequestId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const mr = await this.repo.findMaterialRequest(prisma, orgId, materialRequestId);
    if (!mr) throw new NotFoundException(`Material request ${materialRequestId} not found`);
    if (mr.projectId) await this.access.assertProjectAccess(identity, { projectId: mr.projectId });
    if (!identity.permissions.includes(PERMISSIONS.quotationsCollect)) throw quotationForbidden('MISSING_PERMISSION');

    let created = false;
    let requestId: string;
    try {
      requestId = await prisma.$transaction(async (tx) => {
        await this.repo.lockMaterialRequest(tx, orgId, mr.id);
        const live = await this.repo.findLiveForMaterialRequest(tx, orgId, mr.id);
        if (live) return live.id;

        const current = await this.repo.findMaterialRequest(tx, orgId, mr.id);
        if (!current || current.status !== 'APPROVED') throw quotationConflict('MATERIAL_REQUEST_NOT_APPROVED');
        const ordered = await this.poRepo.liveAllocatedQuantities(tx, current.lines.map((l) => l.id));
        // What is left to order on each line.
        const remaining = current.lines.map((l) => ({
          ...l,
          approvedQuantity: new Decimal((l.approvedQuantity ?? l.requestedQuantity).toString()).sub(
            ordered.get(l.id) ?? new Decimal(0),
          ),
        }));
        const anyOrdered = [...ordered.values()].some((q) => q.greaterThan(0));
        const open = remaining.filter((l) => l.approvedQuantity.greaterThan(0));
        // A first round needs an MR with nothing ordered (ADR-044 §1). After a closed round (its
        // order confirmed), a new round may cover what is left (review M1).
        const closedRounds = anyOrdered ? await this.repo.findClosedRoundsForMaterialRequest(tx, orgId, current.id) : [];
        if (open.length === 0 || (anyOrdered && closedRounds.length === 0)) {
          throw quotationConflict('MATERIAL_REQUEST_ALREADY_ORDERED');
        }

        const estimate = estimateOf(open);
        const number = await this.repo.nextNumber(tx, orgId);
        const request = await tx.quotationRequest.create({
          data: {
            organizationId: orgId,
            number,
            materialRequestId: current.id,
            projectId: current.projectId,
            currencyCode: current.currencyCode ?? 'USD',
            urgent: current.priority === 'URGENT',
            estimateAmount: estimate,
            requiredQuoteCount: requiredCount(estimate),
            createdBy: identity.userId,
          },
        });
        await this.auditOutbox.record(tx, {
          organizationId: orgId,
          actorUserId: identity.userId,
          action: 'CREATE',
          resourceType: 'QuotationRequest',
          resourceId: request.id,
          sourceCommand: 'quotation.open',
          eventType: 'QUOTATION_OPENED',
          idempotencyKey: `quotation-${request.id}-QUOTATION_OPENED`,
          after: { number, materialRequestId: current.id, mrNumber: current.mrNumber, status: 'COLLECTING' },
        });
        created = true;
        return request.id;
      });
    } catch (error) {
      // Lost a race past the lock (should not happen) — the index kept one row; return it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const live = await this.repo.findLiveForMaterialRequest(prisma, orgId, mr.id);
        if (!live) throw error;
        requestId = live.id;
        created = false;
      } else {
        throw error;
      }
    }
    return { created, request: await this.query.detail(identity, requestId) };
  }

  /** S2 — a store's quote: photos only. Idempotent on `clientRef` (the phone's upload queue). */
  async addQuote(identity: RequestIdentity, id: string, input: AddQuoteInput) {
    if (Boolean(input.supplierId) === Boolean(input.storeName?.trim())) {
      throw quotationBadRequest('STORE_REQUIRED', 'Give either a registered supplier or a new store name, not both.');
    }
    if (!input.photos?.length) throw quotationBadRequest('PHOTO_REQUIRED', 'A quote needs at least one photo.');

    try {
      await this.runner.run(
        identity,
        id,
        'ADD_QUOTE',
        async (ctx) => {
          const replaced = input.replacesQuoteId
            ? ctx.request.quotes.find((q) => q.id === input.replacesQuoteId && q.status === 'ACTIVE')
            : null;
          if (input.replacesQuoteId && !replaced) throw quotationConflict('QUOTE_NOT_ACTIVE');

          const key = await this.resolveStoreKey(ctx, input);
          const photos = await this.bindPhotos(ctx, input.photos, 1, replaced?.id ?? null);

          if (replaced) {
            await ctx.tx.quote.update({
              where: { id: replaced.id },
              data: { status: 'WITHDRAWN', withdrawnBy: identity.userId },
            });
          }
          const quote = await ctx.tx.quote.create({
            data: {
              organizationId: ctx.request.organizationId,
              quotationRequestId: ctx.request.id,
              supplierId: input.supplierId ?? null,
              storeName: input.supplierId ? null : input.storeName!.trim().replace(/\s+/g, ' '),
              storeKey: key,
              uploadedBy: identity.userId,
              clientRef: input.clientRef,
              replacesQuoteId: replaced?.id ?? null,
              photos: { create: photos },
            },
          });
          const updated = await this.runner.writeRequest(ctx, ctx.request.status, {}, { collectActor: true });
          if (replaced) {
            await this.runner.audit(ctx, updated.updatedAt, {
              eventType: 'QUOTE_WITHDRAWN',
              sourceCommand: 'quotation.add-quote',
              action: 'UPDATE',
              keySuffix: replaced.id,
              after: { quoteId: replaced.id, replacedBy: quote.id },
            });
          }
          await this.runner.audit(ctx, updated.updatedAt, {
            eventType: 'QUOTE_ADDED',
            sourceCommand: 'quotation.add-quote',
            action: 'CREATE',
            keySuffix: quote.id,
            after: {
              quoteId: quote.id,
              supplierId: quote.supplierId,
              storeName: quote.storeName,
              storeKey: key,
              photoFileIds: photos.map((p) => p.platformFileId),
              replacesQuoteId: replaced?.id ?? null,
            },
          });
        },
        async (ctx) => {
          return Boolean(await this.repo.findQuoteByClientRef(ctx.tx, ctx.request.id, input.clientRef));
        },
      );
    } catch (error) {
      // Two deliveries of one queued upload raced: the unique (request, clientRef) kept the first.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) throw error;
      const prisma = this.tenancy.getClient();
      if (!(await this.repo.findQuoteByClientRef(prisma, id, input.clientRef))) throw error;
    }
    return this.query.detail(identity, id);
  }

  /** An extra page on an ACTIVE quote. Idempotent: the same file twice is one page. */
  async addPage(identity: RequestIdentity, id: string, quoteId: string, photo: QuotePhotoInput) {
    await this.runner.run(
      identity,
      id,
      'ADD_PAGE',
      async (ctx) => {
        const quote = ctx.request.quotes.find((q) => q.id === quoteId);
        if (!quote) throw new NotFoundException(`Quote ${quoteId} not found on this request`);
        if (quote.status !== 'ACTIVE') throw quotationConflict('QUOTE_NOT_ACTIVE');
        const nextPage = Math.max(0, ...quote.photos.map((p) => p.pageNumber)) + 1;
        const [data] = await this.bindPhotos(ctx, [photo], nextPage, null);
        await ctx.tx.quotePhoto.create({ data: { ...data, quoteId: quote.id } });
        const updated = await this.runner.writeRequest(ctx, ctx.request.status, {}, { collectActor: true });
        await this.runner.audit(ctx, updated.updatedAt, {
          eventType: 'QUOTE_PAGE_ADDED',
          sourceCommand: 'quotation.add-page',
          action: 'UPDATE',
          keySuffix: `${quote.id}-${nextPage}`,
          after: { quoteId: quote.id, pageNumber: nextPage, platformFileId: photo.platformFileId },
        });
      },
      async (ctx) =>
        ctx.request.quotes.some((q) => q.id === quoteId && q.photos.some((p) => p.platformFileId === photo.platformFileId)),
    );
    return this.query.detail(identity, id);
  }

  /** The quote leaves the comparison; its photos stay BOUND and retained. */
  async withdrawQuote(identity: RequestIdentity, id: string, quoteId: string) {
    await this.runner.run(identity, id, 'WITHDRAW_QUOTE', async (ctx) => {
      const quote = ctx.request.quotes.find((q) => q.id === quoteId);
      if (!quote) throw new NotFoundException(`Quote ${quoteId} not found on this request`);
      if (quote.status !== 'ACTIVE') throw quotationConflict('QUOTE_NOT_ACTIVE');
      await ctx.tx.quote.update({ where: { id: quote.id }, data: { status: 'WITHDRAWN', withdrawnBy: identity.userId } });
      const updated = await this.runner.writeRequest(ctx, ctx.request.status, {}, { collectActor: true });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTE_WITHDRAWN',
        sourceCommand: 'quotation.withdraw-quote',
        action: 'UPDATE',
        keySuffix: quote.id,
        before: { quoteStatus: 'ACTIVE' },
        after: { quoteId: quote.id, quoteStatus: 'WITHDRAWN' },
      });
    });
    return this.query.detail(identity, id);
  }

  /**
   * S2/S3 — send to finance: recompute the required count (a short request needs the collector's
   * exception reason), open a new SLA cycle, and freeze the evidence (photos of ACTIVE quotes →
   * IMMUTABLE).
   */
  async send(identity: RequestIdentity, id: string, exceptionReason?: QuoteCountExceptionInput) {
    await this.runner.run(identity, id, 'SEND', async (ctx) => {
      const estimate = ctx.request.estimateAmount === null ? null : new Decimal(ctx.request.estimateAmount.toString());
      const required = requiredCount(estimate);
      const distinct = distinctCount(ctx.request.quotes);
      const block = countBlock({ distinct, required, exceptionReason: exceptionReason ?? null });
      if (block) {
        throw quotationConflict(block, undefined, { required, distinct });
      }
      const now = new Date();
      const updated = await this.runner.writeRequest(ctx, ctx.request.status, {
        status: 'AWAITING_DECISION',
        requiredQuoteCount: required,
        exceptionReason: exceptionReason ?? null,
        sendCount: { increment: 1 },
        sentAt: now,
        firstSentAt: ctx.request.firstSentAt ?? now,
        decidedAt: null,
      }, { collectActor: true });
      const frozen = await this.repo.freezeActivePhotos(ctx.tx, ctx.request.id, `quotation sent ${ctx.request.number}`);
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_SENT',
        sourceCommand: 'quotation.send',
        before: { status: ctx.request.status },
        after: {
          status: 'AWAITING_DECISION',
          sendCount: updated.sendCount,
          requiredQuoteCount: required,
          distinctSupplierCount: distinct,
          exceptionReason: exceptionReason ?? null,
          photosFrozen: frozen,
        },
      });
      await this.notifier.sent(ctx, updated);
    });
    return this.query.detail(identity, id);
  }

  /** Back to COLLECTING to add or replace evidence after sending. Audited with the reason. */
  async reopen(identity: RequestIdentity, id: string, reason: string) {
    const text = requireText(reason, 'A reason is required to reopen a sent request.');
    await this.runner.run(identity, id, 'REOPEN', async (ctx) => {
      const updated = await this.runner.writeRequest(ctx, 'AWAITING_DECISION', { status: 'COLLECTING' }, { collectActor: true });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_REOPENED',
        sourceCommand: 'quotation.reopen',
        before: { status: 'AWAITING_DECISION' },
        after: { status: 'COLLECTING' },
        reason: text,
      });
      await this.notifier.reopened(ctx);
    });
    return this.query.detail(identity, id);
  }

  /** Any state but an award whose order was issued. A pending award approval is voided. */
  async cancel(identity: RequestIdentity, id: string, reason: string) {
    const text = requireText(reason, 'A reason is required to cancel a quotation request.');
    await this.runner.run(identity, id, 'CANCEL', async (ctx) => {
      await this.cancelInContext(ctx, text, 'quotation.cancel');
    });
    return this.query.detail(identity, id);
  }

  /** The cancel write + audit, shared with the MR-cancel cascade. */
  async cancelInContext(ctx: CommandContext, reason: string, sourceCommand: string) {
    const updated = await this.runner.writeRequest(ctx, ctx.request.status, {
      status: 'CANCELLED',
      cancelledBy: ctx.identity.userId,
      cancelledAt: new Date(),
      cancelReason: reason,
    });
    await this.runner.audit(ctx, updated.updatedAt, {
      eventType: 'QUOTATION_CANCELLED',
      sourceCommand,
      before: { status: ctx.request.status },
      after: { status: 'CANCELLED' },
      reason,
    });
    // Review H1: a pending award's approval is voided in the same transaction as the cancel.
    await this.commandGovernance.voidOpenApprovalIn(ctx.tx, WorkflowTransactionType.QUOTATION_AWARD, ctx.request.id);
    await this.notifier.cancelled(ctx);
  }

  private async resolveStoreKey(ctx: CommandContext, input: AddQuoteInput): Promise<string> {
    const orgId = ctx.request.organizationId;
    if (input.supplierId) {
      const supplier = await this.repo.findSupplier(ctx.tx, orgId, input.supplierId);
      if (!supplier) throw new NotFoundException(`Supplier ${input.supplierId} not found`);
      if (supplier.status !== 'ACTIVE') throw quotationConflict('SUPPLIER_INACTIVE');
      return storeKey({ supplierId: supplier.id });
    }
    const name = input.storeName!.trim();
    if (name.length > 120) throw quotationBadRequest('STORE_NAME_TOO_LONG', 'A store name is at most 120 characters.');
    const registered = await this.repo.findSuppliersByNormalisedName(ctx.tx, orgId, [normaliseStoreName(name)]);
    return storeKey({ storeName: name }, registered);
  }

  /**
   * Checks and binds each uploaded photo (ADR-044 Q3): the caller's own READY, TEMPORARY image
   * (jpeg/png/webp/heic, ≤ 8 MB) with a recorded SHA-256, not already on another ACTIVE quote of
   * this request. TEMPORARY → BOUND as a compare-and-set, inside the command's transaction.
   */
  private async bindPhotos(
    ctx: CommandContext,
    photos: QuotePhotoInput[],
    firstPage: number,
    ignoreQuoteId: string | null,
  ) {
    const orgId = ctx.request.organizationId;
    const taken = new Set(
      ctx.request.quotes
        .filter((q) => q.status === 'ACTIVE' && q.id !== ignoreQuoteId)
        .flatMap((q) => q.photos.map((p) => p.sha256)),
    );
    const rows: Array<Omit<Prisma.QuotePhotoUncheckedCreateInput, 'quoteId'>> = [];
    for (const [i, photo] of photos.entries()) {
      const file = await this.repo.findFile(ctx.tx, orgId, photo.platformFileId);
      if (!file) throw new NotFoundException(`File ${photo.platformFileId} not found`);
      if (file.uploadedBy !== ctx.identity.userId) {
        throw new ForbiddenException({
          errorCode: 'FORBIDDEN',
          message: 'You can only attach a photo that you uploaded.',
          details: { code: 'FILE_NOT_ATTACHABLE' },
        });
      }
      if (file.status !== 'READY') {
        throw quotationConflict('FILE_NOT_ATTACHABLE', 'The photo has not finished uploading.');
      }
      if (file.lifecycle !== 'TEMPORARY') {
        throw quotationConflict('FILE_NOT_ATTACHABLE', 'That photo is already attached to a record.');
      }
      if (!(QUOTE_PHOTO_MIME_TYPES as readonly string[]).includes(file.mimeType)) {
        throw quotationBadRequest('FILE_NOT_ATTACHABLE', 'A quote photo must be a JPEG, PNG, WebP or HEIC image.');
      }
      if (file.sizeBytes > QUOTE_PHOTO_MAX_BYTES) {
        throw quotationBadRequest('FILE_NOT_ATTACHABLE', 'A quote photo is at most 8 MB.');
      }
      const sha = file.checksumSha256?.toLowerCase() ?? '';
      if (!SHA256_HEX.test(sha)) {
        throw quotationBadRequest('FILE_NOT_ATTACHABLE', 'The photo has no recorded checksum; upload it again.');
      }
      if (taken.has(sha)) throw quotationConflict('QUOTE_PHOTO_DUPLICATE');
      taken.add(sha);

      const capturedAt = new Date(photo.capturedAt);
      if (Number.isNaN(capturedAt.getTime())) {
        throw quotationBadRequest('CAPTURED_AT_INVALID', 'capturedAt must be an ISO date-time.');
      }
      const bound = await this.repo.bindFile(
        ctx.tx,
        orgId,
        file.id,
        ctx.identity.userId,
        `quotation ${ctx.request.number}`,
      );
      if (!bound) throw quotationConflict('FILE_NOT_ATTACHABLE', 'That photo is already attached to a record.');
      rows.push({
        organizationId: orgId,
        platformFileId: file.id,
        pageNumber: firstPage + i,
        sha256: sha,
        capturedAt,
        source: photo.source,
        uploadedBy: ctx.identity.userId,
      });
    }
    return rows;
  }
}

/** Σ quantity × estimated unit price when EVERY line is priced (2 dp), else null (unknown). */
export function estimateOf(
  lines: ReadonlyArray<{
    approvedQuantity: { toString(): string } | null;
    requestedQuantity: { toString(): string };
    estimatedUnitPrice: { toString(): string } | null;
  }>,
): Decimal | null {
  if (lines.length === 0 || lines.some((l) => l.estimatedUnitPrice === null)) return null;
  return lines
    .reduce(
      (sum, l) =>
        sum.add(new Decimal((l.approvedQuantity ?? l.requestedQuantity).toString()).mul(new Decimal(l.estimatedUnitPrice!.toString()))),
      new Decimal(0),
    )
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

function requireText(value: string | undefined, message: string): string {
  const text = value?.trim();
  if (!text) throw quotationBadRequest('REASON_REQUIRED', message);
  return text;
}
