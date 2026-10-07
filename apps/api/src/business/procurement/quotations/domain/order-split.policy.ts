import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-044 §8 — turning one awarded total into purchase-order line prices. Pure.
 *
 * The award prices the whole MR, so the server can only split it honestly when every line carries
 * an estimate (pro-rata by estimated value) or there is just one line. Otherwise — some line
 * unpriced, several lines — a split by quantity across different units would be meaningless, and
 * the collector enters the line amounts within the award (MANUAL).
 *
 * Unit prices are rounded DOWN to 4 dp, so Σ unitPrice × qty ≤ awardedTotal by construction; the
 * shortfall is below qty × 0.0001 per line.
 */

export type SplitMode = 'ESTIMATE' | 'SINGLE_LINE' | 'MANUAL';

export interface SplitLineInput {
  id: string;
  /** The quantity to order (the line's remaining approved quantity). */
  quantity: Decimal;
  estimatedUnitPrice: Decimal | null;
}

export interface SplitLine {
  id: string;
  quantity: Decimal;
  /** The line's share of the award (2 dp, rounded down); null in MANUAL mode. */
  amount: Decimal | null;
  /** floor₄(share / quantity); null in MANUAL mode. */
  unitPrice: Decimal | null;
}

export const floor4 = (d: Decimal) => d.toDecimalPlaces(4, Decimal.ROUND_DOWN);
export const floor2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_DOWN);

export function splitAwardAcrossLines(
  total: Decimal,
  lines: ReadonlyArray<SplitLineInput>,
): { mode: SplitMode; lines: SplitLine[] } {
  // Review L1: amounts sit on the 2-dp grid and the unit price derives from the AMOUNT, so the
  // stored line amount round₂(qty × unitPrice) ≤ amount (rounding never passes a grid point above).
  const priced = (amount: Decimal, l: SplitLineInput): SplitLine => ({
    id: l.id,
    quantity: l.quantity,
    amount,
    unitPrice: floor4(amount.div(l.quantity)),
  });

  if (lines.length === 1) {
    return { mode: 'SINGLE_LINE', lines: [priced(floor2(total), lines[0])] };
  }

  const values = lines.map((l) => (l.estimatedUnitPrice === null ? null : l.quantity.mul(l.estimatedUnitPrice)));
  const sum = values.reduce<Decimal>((s, v) => (v === null ? s : s.add(v)), new Decimal(0));
  if (lines.length > 1 && values.every((v) => v !== null) && sum.greaterThan(0)) {
    // Each share floored to the cent; the rounding remainder goes to the last line, so the amounts
    // sum to the award exactly and none exceeds it.
    const amounts = lines.map((_, i) => floor2(total.mul(values[i]!).div(sum)));
    const others = amounts.slice(0, -1).reduce((s, a) => s.add(a), new Decimal(0));
    amounts[amounts.length - 1] = floor2(total).sub(others);
    return { mode: 'ESTIMATE', lines: lines.map((l, i) => priced(amounts[i], l)) };
  }

  return {
    mode: 'MANUAL',
    lines: lines.map((l) => ({ id: l.id, quantity: l.quantity, amount: null, unitPrice: null })),
  };
}

export interface ManualLineInput {
  materialRequestLineId: string;
  quantity: Decimal;
  amount: Decimal;
}

export type ManualLinesBlock =
  | 'ORDER_LINES_REQUIRED'
  | 'ORDER_LINE_NOT_ON_REQUEST'
  | 'ORDER_LINE_DUPLICATED'
  | 'ORDER_LINE_QUANTITY_INVALID'
  | 'ORDER_LINE_AMOUNT_INVALID'
  | 'PO_EXCEEDS_AWARD';

/**
 * Lines the collector adjusted: only lines of the request's MR (none added), each at most once,
 * 0 < quantity ≤ remaining, amount > 0 with ≤ 2 dp, Σ amount ≤ the award. Lines may be dropped.
 */
export function validateManualLines(
  total: Decimal,
  lines: ReadonlyArray<ManualLineInput>,
  remainingByLineId: ReadonlyMap<string, Decimal>,
): ManualLinesBlock | null {
  if (lines.length === 0) return 'ORDER_LINES_REQUIRED';
  const seen = new Set<string>();
  let sum = new Decimal(0);
  for (const line of lines) {
    const remaining = remainingByLineId.get(line.materialRequestLineId);
    if (remaining === undefined) return 'ORDER_LINE_NOT_ON_REQUEST';
    if (seen.has(line.materialRequestLineId)) return 'ORDER_LINE_DUPLICATED';
    seen.add(line.materialRequestLineId);
    if (line.quantity.lessThanOrEqualTo(0) || line.quantity.greaterThan(remaining)) {
      return 'ORDER_LINE_QUANTITY_INVALID';
    }
    if (line.amount.lessThanOrEqualTo(0) || line.amount.decimalPlaces() > 2) return 'ORDER_LINE_AMOUNT_INVALID';
    sum = sum.add(line.amount);
  }
  return sum.greaterThan(total) ? 'PO_EXCEEDS_AWARD' : null;
}
