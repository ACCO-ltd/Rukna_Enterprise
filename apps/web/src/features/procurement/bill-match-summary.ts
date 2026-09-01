/**
 * ─── The "Matched" reconciliation line (Slice ④, D6) ─────────────────────────────
 *
 * A healthy PO-backed bill shows a quiet three-figure reconciliation, from the owner's sketch:
 *
 *   ✓ Matched (PO applicable $2,850 · Accepted receipts $2,850 · Bill $2,850) → Ready
 *
 * The three figures are derived from the match result the auto-match already produced — this
 * is display arithmetic over numbers the server computed, not a re-derivation of the match:
 *
 *  - **PO applicable**   Σ (po quantity × po unit price) over the matched lines — the PO value
 *                        of the lines this bill covers.
 *  - **Accepted receipts** Σ (received quantity × po unit price) — the value of what was
 *                        accepted at the PO price. Falls back to the PO value on a two-way
 *                        match, where a line has no receipt (received is null).
 *  - **Bill**            the bill's own total. Rendered by the caller from `bill.totalAmount`.
 *
 * In the healthy case these three agree, which is what "Matched" means. They are computed in
 * integer minor units and returned as decimal strings, so the caller formats them exactly as
 * it formats every other money value — summing decimal strings as floats is how a
 * reconciliation ends up a cent away from the bill it reconciles.
 */

import { MONEY_SCALE, QUANTITY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import type { BillMatchResult } from './types';

export interface BillMatchReconciliation {
  /** Σ po-qty × po-price, as a `Decimal(18,2)` string — `"2850.00"`. */
  poApplicable: string;
  /** Σ received-qty × po-price (received → po-qty on a two-way line), as a decimal string. */
  acceptedReceipts: string;
}

/**
 * `qtyMinor × priceMinor` back down to money minor units. Quantity carries three decimals and
 * price two, so their product carries five and has to return to two: `/ 10^3`, rounded
 * half-up away from zero to match how the value lands in a `Decimal(18,2)` column.
 */
function extendMinor(qtyMinor: number, priceMinor: number): number {
  const product = qtyMinor * priceMinor; // 5dp
  const scaleDown = 10 ** QUANTITY_SCALE; // 10^3
  return Math.round(product / scaleDown);
}

export function billMatchReconciliation(result: BillMatchResult): BillMatchReconciliation {
  let poMinor = 0;
  let acceptedMinor = 0;

  for (const line of result.lines) {
    const poQty = toMinorUnits(line.poQuantity, QUANTITY_SCALE);
    const poPrice = toMinorUnits(line.poUnitPrice, MONEY_SCALE);
    poMinor += extendMinor(poQty, poPrice);

    // A two-way (PO-only) match has no receipt — received is null — so the accepted figure
    // falls back to the PO quantity, which is what the two-way match compares against.
    const receivedQty =
      line.receivedQuantity !== null
        ? toMinorUnits(line.receivedQuantity, QUANTITY_SCALE)
        : poQty;
    acceptedMinor += extendMinor(receivedQty, poPrice);
  }

  return {
    poApplicable: fromMinorUnits(poMinor, MONEY_SCALE),
    acceptedReceipts: fromMinorUnits(acceptedMinor, MONEY_SCALE),
  };
}
