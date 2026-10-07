import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { moneyOrNull } from '../../shared/procurement-money.js';
import { PurchaseOrderRepository } from '../../purchase-orders/infrastructure/purchase-order.repository.js';
import {
  PurchaseOrderService,
  type ResolvedPoLine,
} from '../../purchase-orders/application/purchase-order.service.js';
import { quotationBadRequest, quotationConflict, quotationUnprocessable } from '../domain/quotation-errors.js';
import {
  floor4,
  splitAwardAcrossLines,
  validateManualLines,
  type SplitMode,
} from '../domain/order-split.policy.js';
import { QuotationRequestRepository, type Db, type MaterialRequestForQuotation } from '../infrastructure/quotation-request.repository.js';
import { QuotationAccessService } from './quotation-access.service.js';
import { QuotationCommandRunner } from './quotation-command-runner.service.js';
import { QuotationQueryService } from './quotation-query.service.js';
import { QuotationNotifier } from './quotation-notifier.service.js';

export interface RaiseOrderLineInput {
  materialRequestLineId: string;
  quantity: string | number;
  amount: string | number;
}

export interface RaiseOrderInput {
  lines?: RaiseOrderLineInput[];
  expectedDeliveryDate?: string;
  deliveryAddress?: string;
}

/** Midnight UTC of `d`'s calendar day — the shape a @db.Date column holds. */
const dateOnly = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * ADR-044 Q6 — from award to purchase order. `orderDraft` previews the split; `raiseOrder` creates
 * the DRAFT PO (awarded supplier, one line per MR line, prices within the award, the winning photos
 * as evidence) in the same transaction that links it to the request; `requestRedecision` sends an
 * award back to finance while no order from it was ever issued.
 */
@Injectable()
export class QuotationOrderService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: QuotationRequestRepository,
    private readonly poRepo: PurchaseOrderRepository,
    private readonly purchaseOrders: PurchaseOrderService,
    private readonly access: QuotationAccessService,
    private readonly runner: QuotationCommandRunner,
    private readonly query: QuotationQueryService,
    private readonly notifier: QuotationNotifier,
  ) {}

  /** `GET /:id/order-draft` — what one tap on "Raise the order" would create. */
  async orderDraft(identity: RequestIdentity, id: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const request = await this.repo.findById(prisma, orgId, id);
    if (!request) throw new NotFoundException(`Quotation request ${id} not found`);
    await this.access.assertProjectAccess(identity, request);
    if (request.status !== 'AWARDED' || !request.awardedTotal || !request.awardedSupplierId) {
      throw quotationConflict('QUOTATION_NOT_AWARDED');
    }
    const mr = (await this.repo.findMaterialRequest(prisma, orgId, request.materialRequestId))!;
    const total = new Decimal(request.awardedTotal.toString());
    const remaining = await this.remainingLines(prisma, mr);
    const split = splitAwardAcrossLines(
      total,
      remaining.map((l) => ({ id: l.id, quantity: l.remaining, estimatedUnitPrice: l.estimate })),
    );
    const supplier = await prisma.supplier.findUnique({
      where: { id: request.awardedSupplierId },
      select: { id: true, code: true, name: true },
    });
    const visible = this.access.moneyVisible(identity);
    return {
      quotationRequestId: request.id,
      number: request.number,
      supplier,
      currencyCode: request.currencyCode,
      awardedTotal: moneyOrNull(visible, total),
      paymentPath: request.paymentPath,
      splitMode: split.mode as SplitMode,
      lines: remaining.map((line) => {
        const priced = split.lines.find((l) => l.id === line.id)!;
        return {
          materialRequestLineId: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          quantity: line.remaining.toFixed(4),
          maxQuantity: line.remaining.toFixed(4),
          uom: line.uom,
          amount: moneyOrNull(visible, priced.amount),
          unitPrice: visible && priced.unitPrice ? priced.unitPrice.toFixed(4) : null,
        };
      }),
      moneyVisible: visible,
    };
  }

  /** S7 — `POST /:id/raise-order` → `{ purchaseOrderId }`. */
  async raiseOrder(identity: RequestIdentity, id: string, input: RaiseOrderInput) {
    const manual = input.lines?.map((l, i) => {
      const quantity = parseDecimal(l.quantity, `lines[${i}].quantity`);
      if (quantity.decimalPlaces() > 4) throw quotationUnprocessable('ORDER_LINE_QUANTITY_INVALID');
      return {
        materialRequestLineId: l.materialRequestLineId,
        quantity,
        amount: parseDecimal(l.amount, `lines[${i}].amount`),
      };
    });
    const expectedDeliveryDate = input.expectedDeliveryDate ? new Date(input.expectedDeliveryDate) : undefined;
    if (expectedDeliveryDate && Number.isNaN(expectedDeliveryDate.getTime())) {
      throw quotationBadRequest('EXPECTED_DELIVERY_DATE_INVALID', 'expectedDeliveryDate must be a date.');
    }

    const result = await this.runner.run(identity, id, 'RAISE_ORDER', async (ctx) => {
      const request = ctx.request;
      const total = new Decimal(request.awardedTotal!.toString());
      const remaining = await this.remainingLines(ctx.tx, ctx.mr);
      if (remaining.length === 0) throw quotationConflict('MATERIAL_REQUEST_ALREADY_ORDERED');

      // Quantity and price per MR line: the collector's adjusted lines, or the automatic split.
      let priced: Array<{ lineId: string; quantity: Decimal; unitPrice: Decimal }>;
      if (manual) {
        const block = validateManualLines(
          total,
          manual,
          new Map(remaining.map((l) => [l.id, l.remaining] as const)),
        );
        if (block) throw quotationUnprocessable(block);
        priced = manual.map((l) => ({
          lineId: l.materialRequestLineId,
          quantity: l.quantity,
          unitPrice: floor4(l.amount.div(l.quantity)),
        }));
      } else {
        const split = splitAwardAcrossLines(
          total,
          remaining.map((l) => ({ id: l.id, quantity: l.remaining, estimatedUnitPrice: l.estimate })),
        );
        if (split.mode === 'MANUAL') throw quotationUnprocessable('ORDER_LINES_REQUIRED');
        priced = split.lines.map((l) => ({ lineId: l.id, quantity: l.quantity, unitPrice: l.unitPrice! }));
      }

      const ordered = priced.reduce((sum, l) => sum.add(l.quantity.mul(l.unitPrice)), new Decimal(0));
      if (ordered.greaterThan(total)) throw quotationUnprocessable('PO_EXCEEDS_AWARD');

      const mrLines = new Map(ctx.mr.lines.map((l) => [l.id, l] as const));
      const lines: ResolvedPoLine[] = priced.map((p, i) => {
        const line = mrLines.get(p.lineId)!;
        const projectId = ctx.mr.requestScope === 'PROJECT' ? (ctx.mr.projectId ?? undefined) : undefined;
        return {
          lineNumber: i + 1,
          lineType: line.lineType,
          materialId: line.materialId ?? undefined,
          description: line.description,
          unitOfMeasureId: line.unitOfMeasureId,
          orderedQuantity: p.quantity,
          unitPrice: p.unitPrice,
          extendedAmount: p.quantity.mul(p.unitPrice),
          spendCategoryId: line.spendCategoryId ?? line.material?.defaultSpendCategoryId ?? undefined,
          projectId,
          boqNodeId: line.boqNodeId ?? undefined,
          mrLineAllocations: [{ materialRequestLineId: line.id, allocatedQuantity: p.quantity }],
        };
      });

      const winning = request.quotes.find((q) => q.id === request.awardedQuoteId)!;
      const firstPhoto = winning.photos[0];
      const po = await this.purchaseOrders.createDraftFromAward(ctx.tx, identity, {
        quotationRequestId: request.id,
        supplierId: request.awardedSupplierId!,
        currencyCode: request.currencyCode,
        // The award is the source document of this order: its date, never the clock.
        effectiveFrom: dateOnly(request.awardedAt!),
        reason: `Raised from quotation award ${request.number}`,
        deliveryAddress: input.deliveryAddress,
        expectedDeliveryDate,
        lines,
        quotation: {
          ref: request.number,
          date: firstPhoto ? dateOnly(firstPhoto.capturedAt) : null,
          amount: total,
          evidenceFileIds: winning.photos.map((p) => p.platformFileId),
        },
      });

      const updated = await this.runner.writeRequest(ctx, 'AWARDED', { purchaseOrderId: po.id });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_ORDER_RAISED',
        sourceCommand: 'quotation.raise-order',
        action: 'UPDATE',
        after: {
          purchaseOrderId: po.id,
          poNumber: po.poNumber,
          orderedTotal: ordered.toFixed(4),
          awardedTotal: total.toFixed(2),
          lines: priced.length,
          adjusted: Boolean(manual),
        },
      });
      await this.notifier.orderRaised(ctx);
      return { purchaseOrderId: po.id };
    });
    return result!;
  }

  /**
   * Back to finance: AWARDED → AWAITING_DECISION while no order raised from the award was ever
   * issued (a live draft must be cancelled first). The award is cleared; a new SLA clock starts.
   */
  async requestRedecision(identity: RequestIdentity, id: string, reason: string) {
    const text = reason?.trim();
    if (!text) throw quotationBadRequest('REASON_REQUIRED', 'A reason is required to send an award back to finance.');
    await this.runner.run(identity, id, 'REQUEST_REDECISION', async (ctx) => {
      const before = {
        status: 'AWARDED',
        awardedQuoteId: ctx.request.awardedQuoteId,
        awardedTotal: ctx.request.awardedTotal?.toString() ?? null,
        purchaseOrderId: ctx.request.purchaseOrderId,
      };
      const updated = await this.runner.writeRequest(ctx, 'AWARDED', {
        status: 'AWAITING_DECISION',
        awardedQuoteId: null,
        awardedTotal: null,
        awardedSupplierId: null,
        awardedBy: null,
        awardedAt: null,
        awardApprovalInstanceId: null,
        awardFinalApproverId: null,
        nonLowestReason: null,
        nonLowestNote: null,
        paymentPath: null,
        exceptionAcceptedBy: null,
        exceptionAcceptedAt: null,
        purchaseOrderId: null,
        decidedAt: null,
        sentAt: new Date(),
      });
      await this.runner.audit(ctx, updated.updatedAt, {
        eventType: 'QUOTATION_REDECISION_REQUESTED',
        sourceCommand: 'quotation.request-redecision',
        before,
        after: { status: 'AWAITING_DECISION' },
        reason: text,
      });
      await this.notifier.redecisionRequested(ctx, updated);
    });
    return this.query.detail(identity, id);
  }

  /** MR lines with quantity still to order (approved − live allocations), in line order. */
  private async remainingLines(db: Db, mr: MaterialRequestForQuotation) {
    const allocated = await this.poRepo.liveAllocatedQuantities(db, mr.lines.map((l) => l.id));
    return mr.lines
      .map((line) => {
        const quantity = new Decimal((line.approvedQuantity ?? line.requestedQuantity).toString());
        const remaining = quantity.sub(allocated.get(line.id) ?? new Decimal(0));
        return {
          id: line.id,
          lineNumber: line.lineNumber,
          description: line.description,
          uom: line.uom ? { code: line.uom.code, name: line.uom.name } : null,
          remaining,
          estimate: line.estimatedUnitPrice === null ? null : new Decimal(line.estimatedUnitPrice.toString()),
        };
      })
      .filter((l) => l.remaining.greaterThan(0));
  }
}

function parseDecimal(value: string | number, field: string): Decimal {
  try {
    const d = new Decimal(String(value).trim());
    if (!d.isFinite()) throw new Error('not finite');
    return d;
  } catch {
    throw quotationBadRequest('ORDER_LINE_INVALID', `${field} must be a number.`);
  }
}
