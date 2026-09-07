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

/**
 * The client's answer, kept separate from the internal workflow state.
 *
 * These are genuinely two different facts: a variation can be `INTERNAL_APPROVED` — ACCO has
 * signed off internally — while the client has said nothing at all. Collapsing them into one
 * "Pending" column hides which of the two is holding the money up, which is the single most
 * useful thing the row can tell a commercial manager.
 */
export type VariationClientApproval = 'APPROVED' | 'REJECTED' | 'WITHDRAWN' | 'PENDING' | 'NOT_SUBMITTED';

export function variationClientApproval(
  vo: Pick<VariationOrderListItem, 'status'>,
): VariationClientApproval {
  switch (vo.status) {
    case 'CLIENT_APPROVED':
      return 'APPROVED';
    case 'REJECTED':
      return 'REJECTED';
    case 'WITHDRAWN':
      return 'WITHDRAWN';
    // Internally approved and awaiting the client is the one state where "pending client" is
    // the literal truth. Everything earlier has not reached the client yet.
    case 'INTERNAL_APPROVED':
      return 'PENDING';
    default:
      return 'NOT_SUBMITTED';
  }
}

export interface VariationTotals {
  pendingCount: number;
  approvedCount: number;
  omissionCount: number;
  /** Σ net price of client-approved omissions — a signed, negative decimal string. */
  omissionsTotal: string;
  atRiskCount: number;
  /** Σ recorded at-risk exposure across the contract's variations, as a decimal string. */
  atRiskExposure: string;
}

/**
 * Counts and the two totals the server does not already provide.
 *
 * `omissionsTotal` and `atRiskExposure` are sums of figures the server derived per row, not
 * re-derivations of them: the browser adds numbers it was given, it does not decide what a
 * variation is worth. Amounts are summed in cents to avoid float drift on a column of decimals.
 */
export function summariseVariations(variations: VariationOrderListItem[]): VariationTotals {
  let pendingCount = 0;
  let approvedCount = 0;
  let omissionCount = 0;
  let omissionCents = 0;
  let atRiskCount = 0;
  let atRiskCents = 0;

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

    if (vo.atRiskAuthorisationCount > 0) {
      atRiskCount += 1;
      atRiskCents += toCents(vo.atRiskExposure);
    }
  }

  return {
    pendingCount,
    approvedCount,
    omissionCount,
    omissionsTotal: fromCents(omissionCents),
    atRiskCount,
    atRiskExposure: fromCents(atRiskCents),
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
