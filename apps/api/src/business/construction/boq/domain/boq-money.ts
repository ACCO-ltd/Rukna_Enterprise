/**
 * BOQ arithmetic — CONST-BOQ-014.
 *
 * Every quantity, rate and amount in the BOQ is a `Prisma.Decimal`. Nothing here converts
 * to a JS number, because the columns are `DECIMAL(18,3)` / `DECIMAL(18,2)` and a BOQ total
 * is the figure a contract is signed against.
 *
 * This module previously did not exist: `BoqTreeService` computed
 * `Math.round(quantity * unitRate * 100) / 100` and accumulated section totals as JS
 * doubles (blocker B7). At BOQ scale that is not theoretical — 426 lines of
 * `0.1`-unrepresentable rates drift by cents, and the drift lands in the number a client
 * is invoiced from.
 *
 * Values leave the module as strings, matching `IpaResponse` / `IpcResponse`.
 */

import { Decimal } from '@prisma/client/runtime/library';

/** Quantities carry three decimal places. */
export const QUANTITY_SCALE = 3;
/** Rates and amounts carry two. */
export const AMOUNT_SCALE = 2;

/** A decimal rendered for the wire. Never a `number`. */
export type DecimalString = string;

/**
 * Accepts anything Prisma or a DTO can hand us and returns a Decimal, or null.
 *
 * Strings go in verbatim; a `number` is stringified first so the Decimal is built from the
 * literal the caller wrote rather than from a binary float that already lost precision.
 */
export function toDecimal(value: Decimal | string | number | null | undefined): Decimal | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Decimal) return value;
  const decimal = new Decimal(typeof value === 'number' ? value.toString() : value);
  return decimal.isNaN() ? null : decimal;
}

/** True when the value has no more than `scale` decimal places. */
export function withinScale(value: Decimal, scale: number): boolean {
  return value.decimalPlaces() <= scale;
}

/**
 * `quantity × unitRate`, rounded to amount scale.
 *
 * Returns null for a section, or for an item that is not yet priced — a missing amount and
 * a zero amount are different facts, and readiness depends on telling them apart.
 */
export function lineAmount(
  quantity: Decimal | string | number | null | undefined,
  unitRate: Decimal | string | number | null | undefined,
  isLeaf: boolean | null | undefined,
): Decimal | null {
  if (!isLeaf) return null;
  const q = toDecimal(quantity);
  const r = toDecimal(unitRate);
  if (q === null || r === null) return null;
  return q.mul(r).toDecimalPlaces(AMOUNT_SCALE);
}

/**
 * Sums a set of amounts, treating null as absent rather than zero.
 *
 * Returns null when every input is null, so an unpriced section reports "no total" instead
 * of a confident `0.00`.
 */
export function sumAmounts(amounts: (Decimal | null)[]): Decimal | null {
  let total: Decimal | null = null;
  for (const amount of amounts) {
    if (amount === null) continue;
    total = total === null ? amount : total.plus(amount);
  }
  return total === null ? null : total.toDecimalPlaces(AMOUNT_SCALE);
}

/** Serializes an amount for the wire. */
export function formatAmount(value: Decimal | null): DecimalString | null {
  return value === null ? null : value.toFixed(AMOUNT_SCALE);
}

/** Serializes a quantity for the wire. */
export function formatQuantity(value: Decimal | null): DecimalString | null {
  return value === null ? null : value.toFixed(QUANTITY_SCALE);
}
