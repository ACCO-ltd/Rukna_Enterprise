import type { VariationOrderListItem } from '@erp/types';

/**
 * Pure presentation policy for the Variations list.
 *
 * Kept out of the component so the rules that must not go wrong are unit-testable. Every one of
 * them is a *reading* of server data — none of them re-derives a commercial figure. The two that
 * govern money (approved total, pending total) are not computed here at all: they arrive from the
 * summary read model, because only the server may say what the contract is worth (CONST-VAR-005).
 */

/**
 * Whether a variation adds scope or removes it.
 *
 * Derived from the sign of the server's net price, not from a separate document type — ADR-026
 * CONST-VAR-002 is explicit that an omission is a negative-amount variation, not its own kind of
 * record. A net-zero variation (a like-for-like substitution) is neither and says so.
 */
export type VariationKind = 'VARIATION' | 'OMISSION' | 'NEUTRAL';

export function variationKind(vo: Pick<VariationOrderListItem, 'netPrice'>): VariationKind {
  const net = Number(vo.netPrice);
  if (!Number.isFinite(net) || net === 0) return 'NEUTRAL';
  return net > 0 ? 'VARIATION' : 'OMISSION';
}

export interface VariationTotals {
  approvedCount: number;
  omissionCount: number;
  /** Σ net price of client-approved omissions — a signed, negative decimal string. */
  omissionsTotal: string;
  /**
   * Count of variations still in `PENDING_INTERNAL`/`INTERNAL_APPROVED` — dormant-but-valid
   * statuses under variation-collapse (a raised variation is now client-approved immediately;
   * these two remain reachable only for historical/in-flight rows, per `VariationsTab`'s own
   * doc comment). Almost always zero in current operation, but a real count of already-fetched
   * data, not a fabricated figure.
   */
  pendingCount: number;
}

/**
 * Counts and the one total the server does not already provide.
 *
 * `omissionsTotal` is a sum of figures the server derived per row, not a re-derivation of them:
 * the browser adds numbers it was given, it does not decide what a variation is worth. Amounts
 * are summed in cents to avoid float drift on a column of decimals.
 */
export function summariseVariations(variations: VariationOrderListItem[]): VariationTotals {
  let approvedCount = 0;
  let omissionCount = 0;
  let omissionCents = 0;
  let pendingCount = 0;

  for (const vo of variations) {
    if (vo.status === 'CLIENT_APPROVED') {
      approvedCount += 1;
      if (variationKind(vo) === 'OMISSION') {
        omissionCount += 1;
        omissionCents += toCents(vo.netPrice);
      }
    } else if (vo.status === 'PENDING_INTERNAL' || vo.status === 'INTERNAL_APPROVED') {
      pendingCount += 1;
    }
  }

  return {
    approvedCount,
    omissionCount,
    omissionsTotal: fromCents(omissionCents),
    pendingCount,
  };
}

/** A decimal money string to whole cents. A null (withheld) figure contributes nothing. */
function toCents(value: string | null): number {
  if (value === null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}
