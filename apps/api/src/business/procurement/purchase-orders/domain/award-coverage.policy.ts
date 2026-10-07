import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-044 §7 — is this purchase order's confirmation already approved by a quotation award?
 *
 * The award was made under the PO delegation of authority (the same bands), so a PO raised from it
 * must not ask for a second DoA approval. Pure: the PO repository reads the request linked to the
 * PO (`quotation_requests.purchase_order_id`) and hands the facts in — no module import cycle.
 *
 * Covered when ALL hold:
 *   1. the request is AWARDED and its purchaseOrderId is this PO;
 *   2. this is the PO's first activation (no revision was ever confirmed) — amendments go through
 *      the normal gate;
 *   3. the PO's supplier is the awarded supplier;
 *   4. every draft line allocates only to lines of the request's MR (no foreign lines);
 *   5. draftTotal ≤ awardedTotal.
 * 1 fails → NOT_FROM_AWARD (the normal gate runs unchanged). 2–4 fail → NOT_COVERED (normal gate).
 * 1–4 hold but 5 fails → EXCEEDS_AWARD: refused outright, never a fall-back to the gate (which
 * would be a no-op while the bands are inactive).
 */

export interface AwardFacts {
  status: string;
  purchaseOrderId: string | null;
  awardedSupplierId: string | null;
  awardedTotal: Decimal | null;
  /** The ids of the lines of the request's material request. */
  materialRequestLineIds: ReadonlyArray<string>;
}

export interface CoverageInput {
  award: AwardFacts | null;
  purchaseOrder: { id: string; supplierId: string };
  revisions: ReadonlyArray<{ status: string; approvedAt: Date | null }>;
  /** Per draft line, the MR lines it allocates to. */
  draftLines: ReadonlyArray<{ mrLineIds: ReadonlyArray<string> }>;
  draftTotal: Decimal;
}

export type CoverageResult =
  | { kind: 'COVERED' }
  | { kind: 'EXCEEDS_AWARD' }
  | { kind: 'NOT_FROM_AWARD' }
  | { kind: 'NOT_COVERED'; reason: 'AMENDMENT' | 'SUPPLIER_CHANGED' | 'FOREIGN_LINES' };

export function awardCoverage(input: CoverageInput): CoverageResult {
  const { award, purchaseOrder } = input;
  if (!award || award.status !== 'AWARDED' || award.purchaseOrderId !== purchaseOrder.id) {
    return { kind: 'NOT_FROM_AWARD' };
  }
  const everConfirmed = input.revisions.some(
    (r) => r.approvedAt !== null || r.status === 'ACTIVE' || r.status === 'SUPERSEDED',
  );
  if (everConfirmed) return { kind: 'NOT_COVERED', reason: 'AMENDMENT' };
  if (award.awardedSupplierId !== purchaseOrder.supplierId) {
    return { kind: 'NOT_COVERED', reason: 'SUPPLIER_CHANGED' };
  }
  const mrLines = new Set(award.materialRequestLineIds);
  const foreign = input.draftLines.some(
    (l) => l.mrLineIds.length === 0 || l.mrLineIds.some((id) => !mrLines.has(id)),
  );
  if (foreign) return { kind: 'NOT_COVERED', reason: 'FOREIGN_LINES' };
  if (award.awardedTotal === null || input.draftTotal.greaterThan(award.awardedTotal)) {
    return { kind: 'EXCEEDS_AWARD' };
  }
  return { kind: 'COVERED' };
}
