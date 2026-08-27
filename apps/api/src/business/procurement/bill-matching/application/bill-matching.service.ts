import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
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

// ADR-018/ADR-024 item D — RESOLVED (Eng Ahmed memorandum, 2026-08-27). When no
// MatchingTolerancePolicy is configured the control holds via a flat platform default:
//   price 2%  — a unit-price difference up to 2% auto-clears.
//   qty   0%  — pay against the accepted/received quantity ONLY; no over-bill beyond the
//               reference quantity is tolerated (the cumulative-billed-vs-received mechanism below
//               already enforces this — the 0% simply removes any slack).
// A MatchingTolerancePolicy (org/PO scope) still overrides these; only the fallback changed
// (was 5%/5%). Over-receipt tolerance (5%) is a SEPARATE OverReceiptPolicy on goods receipts and
// is unaffected.
const PLATFORM_FALLBACK_PRICE_PCT = new Decimal('2');
const PLATFORM_FALLBACK_QTY_PCT = new Decimal('0');

// ADR-018/ADR-024 item D — the USD-5 tolerance is applied PER INVOICE (whole bill), not per line.
// After per-line verdicts are derived, a would-be EXCEPTION caused ONLY by price/amount rounding is
// absorbed into MATCHED_WITH_TOLERANCE when the bill's TOTAL amount variance is within this band.
// A quantity over-bill is NEVER absorbed by the $5 (accepted-quantity only). Platform constant,
// overridable later via policy if such a field is added; the per-line figures are always retained
// for display — the $5 changes the verdict, not the recorded numbers.
const PER_INVOICE_ROUNDING_ABS = new Decimal('5');

// ADR-018/ADR-024 item D (Q6) — matching-exception approval authority by bill amount. Reuses ACCO's
// existing finance threshold (the same $1,000 boundary as the DOA value bands, acco-value-bands.ts):
// the Finance ladder's middle tier ("Finance Manager" in the memo = FINANCE_OFFICER in the ACCO role
// registry) may approve an exception when the bill total ≤ USD 1,000; above that requires CFO. No new
// approval-chain binding is introduced — the rule is enforced directly against the approver's roles.
const EXCEPTION_APPROVAL_CFO_THRESHOLD = new Decimal('1000');
const ROLE_CFO = 'CFO';
const ROLE_CEO = 'CEO'; // apex approver — above CFO, so also authorised

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

    if (!bill.purchaseOrderId || !bill.purchaseOrderRevisionId) {
      throw new BadRequestException('Bill is not linked to a PO — cannot run matching');
    }

    // Determine match type: THREE_WAY if any MATERIAL line, else TWO_WAY (ADR-007, Rule MATCH-001)
    const hasMaterialLine = bill.lines.some(l => l.lineType === 'MATERIAL');
    const matchType = hasMaterialLine ? 'THREE_WAY' : 'TWO_WAY';

    // ADR-018 CONST-MATCH-010/011 (Phase 2b): match against the PO's CURRENT active revision, not the
    // revision the bill was created against. When an agreed price/quantity change is resolved via a PO
    // revision (which recommits the ledger on approval), re-running matching here picks up the revised
    // terms and re-points the bill — so the exception clears against the new, committed exposure.
    const poRevision = await this.repo.findActivePoRevisionForPo(prisma, bill.purchaseOrderId);
    if (!poRevision) throw new NotFoundException('Purchase order has no active revision to match against');
    if (poRevision.id !== bill.purchaseOrderRevisionId) {
      await this.repo.repointBillToRevision(prisma, billId, poRevision.id);
    }

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
          if (poLine.materialId) {
            // Received summed by material across the PO — carries across revisions (CONST-MATCH-012).
            cumulativeReceived =
              (await this.repo.sumReceivedForPoMaterial(prisma, bill.purchaseOrderId!, poLine.materialId)) ??
              new Decimal(0);
            const grnLine = await this.repo.findGrnLineForPoMaterial(prisma, bill.purchaseOrderId!, poLine.materialId);
            if (grnLine) grnLineId = grnLine.id;
          } else {
            const grnLine = await this.repo.findGrnLineForPoLine(prisma, poLine.id, poRevision.id);
            if (grnLine) grnLineId = grnLine.id;
            cumulativeReceived = (await this.repo.sumReceivedForPoLine(prisma, poLine.id)) ?? new Decimal(0);
          }
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

    // ADR-018/ADR-024 item D — per-invoice USD-5 rounding absorb (Q4). Applied to the WHOLE bill, not
    // per line: sum the line amount variances; if a would-be exception is caused ONLY by price/amount
    // rounding (every line's quantity is within tolerance — no over-bill on the accepted quantity) and
    // the bill's total amount variance is within USD 5, absorb it into MATCHED_WITH_TOLERANCE. A
    // quantity over-bill is NEVER absorbed by the $5 (Q2: accepted-quantity only), regardless of the
    // dollar size. The per-line variance figures are retained unchanged — only the verdict moves.
    const totalAmountVariance = matchLines.reduce((s, l) => s.add(l.amountVariance), new Decimal(0));
    const allQuantitiesWithinTolerance = matchLines.every(l => l.quantityWithinTolerance);
    const roundingAbsorb =
      anyException &&
      allQuantitiesWithinTolerance &&
      totalAmountVariance.abs().lessThanOrEqualTo(PER_INVOICE_ROUNDING_ABS);

    const finalStatus =
      anyException && !roundingAbsorb
        ? 'EXCEPTION'
        : anyVariance || roundingAbsorb
          ? 'MATCHED_WITH_TOLERANCE'
          : 'MATCHED';

    await this.repo.createOrReplace(prisma, billId, matchType, matchLines);
    await this.repo.updateStatus(prisma, billId, finalStatus, {
      matchedAt: new Date(),
      matchedBy: identity.userId,
    });
    await this.repo.updateBillMatchStatus(prisma, billId, finalStatus);

    return this.repo.findByBillId(prisma, billId);
  }

  // ADR-018/ADR-024 item D (Q6) — exception-approval authority by bill amount. The Finance ladder's
  // middle tier ("Finance Manager" per the memo = FINANCE_OFFICER in ACCO's role registry) may
  // approve a matching exception only when the bill total is within EXCEPTION_APPROVAL_CFO_THRESHOLD;
  // above that requires CFO (the CEO apex is also authorised). Enforced directly against the
  // approver's roles — the same $1,000 boundary ACCO's DOA value bands already use — rather than a
  // new governance binding. Throws 403 with a clear message when a sub-CFO approver exceeds the band.
  private assertApprovalAuthority(identity: RequestIdentity, billTotal: Decimal): void {
    if (billTotal.lessThanOrEqualTo(EXCEPTION_APPROVAL_CFO_THRESHOLD)) return;
    const hasCfoAuthority = identity.roles.includes(ROLE_CFO) || identity.roles.includes(ROLE_CEO);
    if (!hasCfoAuthority) {
      throw new ForbiddenException(
        `Matching exceptions above USD ${EXCEPTION_APPROVAL_CFO_THRESHOLD.toFixed(0)} require CFO approval — ` +
          `this bill total is USD ${billTotal.toFixed(2)}. A Finance Manager can approve only up to ` +
          `USD ${EXCEPTION_APPROVAL_CFO_THRESHOLD.toFixed(0)}.`,
      );
    }
  }

  async approveException(identity: RequestIdentity, billId: string, dto: ApproveExceptionDto) {
    const prisma = this.tenancy.getClient();
    const match = await this.repo.findByBillId(prisma, billId);
    if (!match) throw new NotFoundException(`No match result for bill ${billId}`);
    if (match.status !== 'EXCEPTION' && match.status !== 'MATCHED_WITH_TOLERANCE') {
      throw new ConflictException(`Match status is ${match.status} — no exception to approve`);
    }

    // ADR-018/ADR-024 item D — authority by amount: FM ≤ USD 1,000, CFO above.
    const billTotal = await this.repo.findBillTotal(prisma, billId);
    if (!billTotal) throw new NotFoundException(`Supplier bill ${billId} not found`);
    this.assertApprovalAuthority(identity, new Decimal(billTotal));

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

    // ADR-018/ADR-024 item D — authority by amount applies to a resolution that CLEARS the bill toward
    // posting (APPROVE → APPROVED_EXCEPTION). DISPUTE and the REQUIRE_* paths keep the bill blocked and
    // are not an authorization to pay, so they carry no amount band.
    if (action === 'APPROVE') {
      const billTotal = await this.repo.findBillTotal(prisma, billId);
      if (!billTotal) throw new NotFoundException(`Supplier bill ${billId} not found`);
      this.assertApprovalAuthority(identity, new Decimal(billTotal));
    }

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
