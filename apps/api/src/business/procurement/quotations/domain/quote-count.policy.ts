import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-044 §4 invariant 5 — how many distinct stores a request needs, and what counts as distinct.
 * Pure.
 */

/** Above this value (USD, strictly greater) three quotes are required; at or below, one. */
export const QUOTE_COUNT_THRESHOLD = new Decimal('100.00');

/** lower(trim(collapse-spaces(name))) — the identity of a new store's name. */
export function normaliseStoreName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * `supplier:<id>` for a registered supplier; `name:<normalised>` for a new store — unless the new
 * store's name equals (after normalisation) a registered supplier's name in the org, in which case
 * it IS that supplier for counting purposes (one store cannot count twice).
 */
export function storeKey(
  store: { supplierId: string } | { storeName: string },
  registeredSuppliers: ReadonlyArray<{ id: string; name: string }> = [],
): string {
  if ('supplierId' in store) return `supplier:${store.supplierId}`;
  const normalised = normaliseStoreName(store.storeName);
  const match = registeredSuppliers.find((s) => normaliseStoreName(s.name) === normalised);
  return match ? `supplier:${match.id}` : `name:${normalised}`;
}

/** Distinct stores among ACTIVE quotes. */
export function distinctCount(quotes: ReadonlyArray<{ status: string; storeKey: string }>): number {
  return new Set(quotes.filter((q) => q.status === 'ACTIVE').map((q) => q.storeKey)).size;
}

/**
 * 3 or 1. At send (`awardTotal` omitted) an unknown estimate asks for 3 — the server then allows
 * fewer only with a reason. At award (`awardTotal` given) the rule is the ADR's:
 * 3 if (estimate known and > 100.00) or award > 100.00, else 1.
 */
export function requiredCount(estimate: Decimal | null, awardTotal?: Decimal | null): 1 | 3 {
  const above = (d: Decimal | null | undefined) => d != null && d.greaterThan(QUOTE_COUNT_THRESHOLD);
  if (awardTotal === undefined) return estimate === null || above(estimate) ? 3 : 1;
  return above(estimate) || above(awardTotal) ? 3 : 1;
}

/**
 * Whether a short request may proceed. At send it needs the collector's exception reason; at award
 * it needs that reason AND the selector's explicit acceptance (`acceptException`).
 */
export function countBlock(input: {
  distinct: number;
  required: number;
  exceptionReason: string | null;
  /** Omit at send; true/false at award. */
  acceptException?: boolean;
}): 'QUOTE_COUNT_EXCEPTION_REQUIRED' | null {
  if (input.distinct >= input.required) return null;
  if (!input.exceptionReason) return 'QUOTE_COUNT_EXCEPTION_REQUIRED';
  if (input.acceptException === false) return 'QUOTE_COUNT_EXCEPTION_REQUIRED';
  return null;
}
