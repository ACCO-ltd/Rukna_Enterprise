import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-044 §4 invariants 3–4 — the numbers finance types, which quote is lowest, and what an award
 * needs. Pure.
 */

export interface QuoteForSelection {
  id: string;
  status: 'ACTIVE' | 'WITHDRAWN' | 'REJECTED';
  enteredTotal: Decimal | null;
}

export const MAX_QUOTE_TOTAL = new Decimal('999999999.99');

/**
 * A typed total: a positive decimal string with at most 2 decimal places, ≤ 999,999,999.99.
 * Returns the Decimal, or null when the input is not an acceptable total.
 */
export function parseQuoteTotal(input: unknown): Decimal | null {
  if (typeof input !== 'string' && typeof input !== 'number') return null;
  const text = String(input).trim();
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text)) return null;
  const value = new Decimal(text);
  if (value.lessThanOrEqualTo(0) || value.greaterThan(MAX_QUOTE_TOTAL)) return null;
  return value;
}

const hasTotal = (q: QuoteForSelection) => q.enteredTotal !== null && q.enteredTotal.greaterThan(0);

/** ACTIVE quotes with the minimum entered total among those that have one. Ties: all of them. */
export function lowestQuoteIds(quotes: ReadonlyArray<QuoteForSelection>): string[] {
  const priced = quotes.filter((q) => q.status === 'ACTIVE' && hasTotal(q));
  if (priced.length === 0) return [];
  const min = priced.reduce((m, q) => (q.enteredTotal!.lessThan(m) ? q.enteredTotal! : m), priced[0].enteredTotal!);
  return priced.filter((q) => q.enteredTotal!.equals(min)).map((q) => q.id);
}

export type AwardBlockCode =
  | 'QUOTE_NOT_ACTIVE'
  | 'QUOTE_TOTALS_MISSING'
  | 'NON_LOWEST_REASON_REQUIRED'
  | 'NON_LOWEST_NOTE_REQUIRED';

/**
 * Why `chosenQuoteId` cannot be awarded, or null. Every ACTIVE quote must carry a total > 0 (the
 * comparison is meaningless otherwise); choosing a quote that is not lowest needs a reason, and
 * `OTHER` needs a note.
 */
export function awardBlock(input: {
  quotes: ReadonlyArray<QuoteForSelection>;
  chosenQuoteId: string;
  nonLowestReason?: string | null;
  nonLowestNote?: string | null;
}): AwardBlockCode | null {
  const chosen = input.quotes.find((q) => q.id === input.chosenQuoteId);
  if (!chosen || chosen.status !== 'ACTIVE') return 'QUOTE_NOT_ACTIVE';
  if (input.quotes.some((q) => q.status === 'ACTIVE' && !hasTotal(q))) return 'QUOTE_TOTALS_MISSING';
  if (lowestQuoteIds(input.quotes).includes(chosen.id)) return null;
  if (!input.nonLowestReason) return 'NON_LOWEST_REASON_REQUIRED';
  if (input.nonLowestReason === 'OTHER' && !input.nonLowestNote?.trim()) return 'NON_LOWEST_NOTE_REQUIRED';
  return null;
}
