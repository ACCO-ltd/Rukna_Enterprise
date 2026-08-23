import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import type { RequestIdentity } from '@erp/types';
import { Decimal } from '@prisma/client/runtime/library';
import type { MatchExceptionReason, MatchResolutionAction, BillMatchStatus } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { BillMatchRepository } from '../infrastructure/bill-match.repository.js';

export interface ApproveExceptionDto {
  approvalReason: string;
}

export interface ResolveExceptionDto {
  reason: MatchExceptionReason;
  notes?: string;
}

// ADR-018 CONST-MATCH-008 — the reason determines the resolution path (and thence the status).
const REASON_TO_ACTION: Record<MatchExceptionReason, MatchResolutionAction> = {
  ROUNDING_VARIANCE: 'APPROVE',
  FREIGHT_OR_ADDITIONAL_CHARGE: 'APPROVE',
  OTHER: 'APPROVE',
  SUPPLIER_INVOICE_ERROR: 'DISPUTE',
  AGREED_PRICE_CHANGE: 'REQUIRE_PO_REVISION',
  PO_QUANTITY_CHANGE: 'REQUIRE_PO_REVISION',
  RECEIPT_CORRECTION: 'REQUIRE_RECEIPT_CORRECTION',
};

const ACTION_TO_STATUS: Record<MatchResolutionAction, BillMatchStatus> = {
  APPROVE: 'APPROVED_EXCEPTION', // postable
  DISPUTE: 'DISPUTED', // blocked; supplier re-submits
  REQUIRE_PO_REVISION: 'EXCEPTION', // stays blocked until a PO revision + rematch clears it
  REQUIRE_RECEIPT_CORRECTION: 'EXCEPTION', // stays blocked until the GRN is corrected + rematched
};

// ADR-018 (deferred simplification): when no MatchingTolerancePolicy is configured, the control
// still holds via a flat platform default — mirroring the over-receipt fallback. Tunable per org
// via a policy; the exact numbers are the open item D (seed flat, review at 6 months).
const PLATFORM_FALLBACK_PRICE_PCT = new Decimal('5');
const PLATFORM_FALLBACK_QTY_PCT = new Decimal('5');

@Injectable()
export class BillMatchingService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: BillMatchRepository,
  ) {}

  async findByBillId(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancy.getClient();
    const match = await this.repo.findByBillId(prisma, billId);
    if (!match) throw new NotFoundException(`No match result found for bill ${billId}`);
    return match;
  }

  async runMatching(identity: RequestIdentity, billId: string) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const bill = await this.repo.findBillForMatching(prisma, orgId, billId);
    if (!bill) throw new NotFoundException(`Supplier bill ${billId} not found`);
    if (bill.postingStatus === 'POSTED') throw new ConflictException('Cannot re-match a posted bill');

    if (!bill.purchaseOrderRevisionId) {
      throw new BadRequestException('Bill is not linked to a PO revision — cannot run matching');
    }

    // Determine match type: THREE_WAY if any MATERIAL line, else TWO_WAY (ADR-007, Rule MATCH-001)
    const hasMaterialLine = bill.lines.some(l => l.lineType === 'MATERIAL');
    const matchType = hasMaterialLine ? 'THREE_WAY' : 'TWO_WAY';

    const poRevision = await this.repo.findPoRevisionForMatching(prisma, bill.purchaseOrderRevisionId);
    if (!poRevision) throw new NotFoundException('Associated PO revision not found');

    const poPolicy = await this.repo.findPoTolerancePolicy(prisma, orgId, poRevision.purchaseOrderId);
    const orgPolicy = await this.repo.findOrgTolerancePolicy(prisma, orgId);
    const policy = poPolicy ?? orgPolicy;

    const priceTolPct = policy?.priceVariancePercent
      ? new Decimal(policy.priceVariancePercent)
      : PLATFORM_FALLBACK_PRICE_PCT;
    const qtyTolPct = policy?.quantityVariancePercent
      ? new Decimal(policy.quantityVariancePercent)
      : PLATFORM_FALLBACK_QTY_PCT;
    const qtyTolAbs = policy?.quantityVarianceAbsolute ? new Decimal(policy.quantityVarianceAbsolute) : null;
    const amountTolAbs = policy?.amountVarianceAbsolute ? new Decimal(policy.amountVarianceAbsolute) : null;

    const matchLines = await Promise.all(
      bill.lines.map(async (billLine, idx) => {
        // Match by materialId when present (MATERIAL lines), else by position
        const poLine = billLine.materialId
          ? poRevision.lines.find(l => l.materialId === billLine.materialId)
          : poRevision.lines[idx];

        if (!poLine) {
          throw new BadRequestException(`No matching PO line found for bill line ${billLine.lineNumber}`);
        }

        const poQty = poLine.orderedQuantity as Decimal;
        const poPrice = poLine.unitPrice as Decimal;
        const billedQty = new Decimal(billLine.quantity ?? 0);
        const billedPrice = new Decimal(billLine.unitPrice ?? 0);

        const qtyVar = billedQty.sub(poQty); // vs PO order — retained for display
        const priceVar = billedPrice.sub(poPrice);
        const amtVar = billedQty.mul(billedPrice).sub(poQty.mul(poPrice));

        // ── Price dimension (CONST-MATCH-003) ──────────────────────────────────
        const priceVarPct = poPrice.greaterThan(0) ? priceVar.abs().div(poPrice).mul(100) : new Decimal(0);
        const priceWithinTolerance = priceVarPct.lessThanOrEqualTo(priceTolPct);

        // ── Quantity dimension: cumulative, bounded by receipts (CONST-MATCH-005/006) ──
        // Three-way matches the billed quantity against what was actually received; two-way (no
        // receipt) against the PO order. Cumulative: a supplier cannot split the full quantity
        // across bills — prior accepted bills on the same PO line count toward the limit.
        let grnLineId: string | undefined;
        let cumulativeReceived: Decimal | undefined;
        if (matchType === 'THREE_WAY') {
          const grnLine = await this.repo.findGrnLineForPoLine(prisma, poLine.id, bill.purchaseOrderRevisionId!);
          if (grnLine) grnLineId = grnLine.id;
          cumulativeReceived = (await this.repo.sumReceivedForPoLine(prisma, poLine.id)) ?? new Decimal(0);
        }
        const referenceQty = matchType === 'THREE_WAY' ? (cumulativeReceived ?? new Decimal(0)) : poQty;
        const priorBilled = (await this.repo.sumBilledForPoLineExcludingBill(prisma, poLine.id, billId)) ?? new Decimal(0);
        const cumulativeBilled = priorBilled.add(billedQty);
        const overBill = cumulativeBilled.sub(referenceQty); // > 0 = billed beyond received/ordered
        const qtyAllowance = referenceQty.mul(qtyTolPct).div(100).add(qtyTolAbs ?? new Decimal(0));
        const quantityWithinTolerance = overBill.lessThanOrEqualTo(qtyAllowance);

        // ── Amount dimension (CONST-MATCH-003) — evaluated when a policy sets an absolute limit ──
        const amountWithinTolerance = !amountTolAbs || amtVar.abs().lessThanOrEqualTo(amountTolAbs);

        // ── Derived overall verdict (CONST-MATCH-004) ──────────────────────────
        const withinTolerance = quantityWithinTolerance && priceWithinTolerance && amountWithinTolerance;
        const failed: string[] = [];
        if (!quantityWithinTolerance) failed.push(`quantity (cumulative billed ${cumulativeBilled.toFixed(2)} vs received/ordered ${referenceQty.toFixed(2)})`);
        if (!priceWithinTolerance) failed.push(`price (${priceVarPct.toFixed(2)}% > ${priceTolPct.toFixed(2)}%)`);
        if (!amountWithinTolerance) failed.push(`amount (variance ${amtVar.toFixed(2)})`);

        return {
          supplierBillLineId: billLine.id,
          purchaseOrderLineId: poLine.id,
          goodsReceiptLineId: grnLineId,
          poQuantity: poQty,
          receivedQuantity: cumulativeReceived,
          billedQuantity: billedQty,
          poUnitPrice: poPrice,
          billedUnitPrice: billedPrice,
          quantityVariance: qtyVar,
          priceVariance: priceVar,
          amountVariance: amtVar,
          quantityWithinTolerance,
          priceWithinTolerance,
          amountWithinTolerance,
          withinTolerance,
          exceptionReason: withinTolerance ? undefined : `Out of tolerance: ${failed.join('; ')}`,
        };
      }),
    );

    // ADR-018 CONST-MATCH-004/002: any dimension out of tolerance makes the bill an EXCEPTION (the
    // posting gate blocks it). Otherwise, a tolerated but non-zero variance is MATCHED_WITH_TOLERANCE
    // (auto-absorbed, posts with the numbers retained); an exact match is MATCHED.
    const anyException = matchLines.some(l => !l.withinTolerance);
    const anyVariance = matchLines.some(
      l => l.withinTolerance && (!l.priceVariance.isZero() || !l.quantityVariance.isZero() || !l.amountVariance.isZero()),
    );
    const finalStatus = anyException ? 'EXCEPTION' : anyVariance ? 'MATCHED_WITH_TOLERANCE' : 'MATCHED';

    await this.repo.createOrReplace(prisma, billId, matchType, matchLines);
    await this.repo.updateStatus(prisma, billId, finalStatus, {
      matchedAt: new Date(),
      matchedBy: identity.userId,
    });
    await this.repo.updateBillMatchStatus(prisma, billId, finalStatus);

    return this.repo.findByBillId(prisma, billId);
  }

  async approveException(identity: RequestIdentity, billId: string, dto: ApproveExceptionDto) {
    const prisma = this.tenancy.getClient();
    const match = await this.repo.findByBillId(prisma, billId);
    if (!match) throw new NotFoundException(`No match result for bill ${billId}`);
    if (match.status !== 'EXCEPTION' && match.status !== 'MATCHED_WITH_TOLERANCE') {
      throw new ConflictException(`Match status is ${match.status} — no exception to approve`);
    }

    // Backward-compatible free-text approval — recorded as a structured OTHER/APPROVE resolution.
    await this.repo.updateStatus(prisma, billId, 'APPROVED_EXCEPTION', {
      approvedBy: identity.userId,
      approvedAt: new Date(),
      approvalReason: dto.approvalReason,
      resolutionReason: 'OTHER',
      resolutionAction: 'APPROVE',
      resolutionNotes: dto.approvalReason,
    });
    await this.repo.updateBillMatchStatus(prisma, billId, 'APPROVED_EXCEPTION');

    return this.repo.findByBillId(prisma, billId);
  }

  /**
   * ADR-018 CONST-MATCH-007/008/009/014 — resolve an exception by its structured reason. The reason
   * fixes the resolution path: APPROVE (absorb / additional cost / manual) → APPROVED_EXCEPTION and
   * posts; DISPUTE (supplier invoice error) → DISPUTED, never posts; a PO-revision or receipt-
   * correction reason keeps the bill an EXCEPTION until the correction + a re-match clears it. The
   * reason, action, resolver and notes are recorded on the match as the audit trail.
   */
  async resolveException(identity: RequestIdentity, billId: string, dto: ResolveExceptionDto) {
    const prisma = this.tenancy.getClient();
    const match = await this.repo.findByBillId(prisma, billId);
    if (!match) throw new NotFoundException(`No match result for bill ${billId}`);
    if (match.status !== 'EXCEPTION') {
      throw new ConflictException(`Match status is ${match.status} — only an EXCEPTION can be resolved`);
    }

    const action = REASON_TO_ACTION[dto.reason];
    const newStatus = ACTION_TO_STATUS[action];

    await this.repo.updateStatus(prisma, billId, newStatus, {
      approvedBy: identity.userId,
      approvedAt: new Date(),
      resolutionReason: dto.reason,
      resolutionAction: action,
      resolutionNotes: dto.notes,
    });
    await this.repo.updateBillMatchStatus(prisma, billId, newStatus);

    return this.repo.findByBillId(prisma, billId);
  }
}
