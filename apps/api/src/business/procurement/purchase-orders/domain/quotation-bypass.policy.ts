/**
 * ADR-044 — no manual bypass of quotation rounds (review M1).
 *
 * An MR covered by a non-cancelled quotation round never takes manual PO allocations:
 *  - while its round is LIVE (not closed: collecting, deciding, awarded but the award's order not
 *    yet confirmed), the round's own "Raise the order" is the only way to order it
 *    → `QUOTATION_IN_PROGRESS`;
 *  - once every round is CLOSED (the award's order confirmed), whatever quantity that order left
 *    out is ordered only through a NEW round → `QUOTATION_ROUND_REQUIRED`.
 * A manual PO would set the price the round exists to set and skip finance's choice and the
 * award's approval. The raise-order path itself (`raisingQuotationRequestId`) is exempt.
 *
 * Pure.
 */

export interface QuotationRoundFacts {
  id: string;
  number: string;
  /** Null while the round is live. */
  closedAt: Date | null;
}

export type ManualOrderBlock =
  | { code: 'QUOTATION_IN_PROGRESS'; round: QuotationRoundFacts }
  | { code: 'QUOTATION_ROUND_REQUIRED'; round: QuotationRoundFacts };

/**
 * @param rounds the MR's non-cancelled quotation requests, newest first.
 */
export function manualOrderBlock(
  rounds: ReadonlyArray<QuotationRoundFacts>,
  raisingQuotationRequestId?: string,
): ManualOrderBlock | null {
  if (raisingQuotationRequestId) return null;
  const live = rounds.find((r) => r.closedAt === null);
  if (live) return { code: 'QUOTATION_IN_PROGRESS', round: live };
  if (rounds.length > 0) return { code: 'QUOTATION_ROUND_REQUIRED', round: rounds[0] };
  return null;
}
