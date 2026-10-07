/**
 * Pure rules for raising the order from an award (ADR-044 §8). The server is the authority — it
 * refuses a total over the award (422 `PO_EXCEEDS_AWARD`) — this only keeps the button honest
 * while the buyer edits, in integer minor units (no floats).
 */

import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { OrderDraftLine } from './types';

/** Server quantities are `Decimal(18,4)`. */
export const ORDER_QUANTITY_SCALE = 4;

export interface EditableOrderLine {
  materialRequestLineId: string;
  included: boolean;
  quantity: string;
  amount: string;
}

export function initialOrderLines(lines: OrderDraftLine[]): EditableOrderLine[] {
  return lines.map((line) => ({
    materialRequestLineId: line.materialRequestLineId,
    included: true,
    quantity: trimQuantity(line.quantity),
    amount: line.amount ?? '',
  }));
}

/** "50.0000" → "50", "12.5000" → "12.5" — what a person would type. */
export function trimQuantity(value: string): string {
  if (!value.includes('.')) return value;
  return value.replace(/\.?0+$/, '');
}

export interface OrderCheck {
  totalMinor: number;
  awardMinor: number | null;
  overMinor: number;
  /** Per line id: quantity above what the request still needs, or not a positive number. */
  quantityProblems: Set<string>;
  /** Per line id: amount missing or not positive on an included line. */
  amountProblems: Set<string>;
  noLines: boolean;
  ok: boolean;
}

export function checkOrderLines(
  lines: EditableOrderLine[],
  draft: OrderDraftLine[],
  awardedTotal: string | null | undefined,
): OrderCheck {
  const included = lines.filter((line) => line.included);
  let totalMinor = 0;
  const quantityProblems = new Set<string>();
  const amountProblems = new Set<string>();
  for (const line of included) {
    const max = draft.find((d) => d.materialRequestLineId === line.materialRequestLineId)?.maxQuantity;
    const qty = parseMinorUnits(line.quantity, ORDER_QUANTITY_SCALE);
    const maxQty = max ? parseMinorUnits(max, ORDER_QUANTITY_SCALE) : null;
    if (qty === null || qty <= 0 || (maxQty !== null && qty > maxQty)) quantityProblems.add(line.materialRequestLineId);
    const amount = parseMinorUnits(line.amount, MONEY_SCALE);
    if (amount === null || amount <= 0) amountProblems.add(line.materialRequestLineId);
    else totalMinor += amount;
  }
  const awardMinor = awardedTotal ? parseMinorUnits(awardedTotal, MONEY_SCALE) : null;
  const overMinor = awardMinor === null ? 0 : Math.max(0, totalMinor - awardMinor);
  const noLines = included.length === 0;
  return {
    totalMinor,
    awardMinor,
    overMinor,
    quantityProblems,
    amountProblems,
    noLines,
    ok: !noLines && overMinor === 0 && quantityProblems.size === 0 && amountProblems.size === 0,
  };
}

export function minorToMoney(minor: number): string {
  return fromMinorUnits(minor, MONEY_SCALE);
}
