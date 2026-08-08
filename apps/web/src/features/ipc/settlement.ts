import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

/**
 * ─── How much of a certificate has been paid ────────────────────────────────────
 *
 * Derived from `GET /receipts/certificate/:id/payment-status`, which returns
 * `{ totalAllocated, netCertified, status }` — all three now as decimal strings.
 *
 * **Why this module still exists after C7 (#11) was fixed.** The endpoint's `status` used to
 * compare `totalAllocated` against the certificate's GROSS `certifiedTotal` rather than its
 * `netCertified`, which pinned any certificate carrying a deduction at `PARTIALLY_PAID`
 * forever — a 5% retention made `PAID` unreachable. The server now compares against
 * `netCertified` and agrees with us. Two things keep the local derivation:
 *
 *  1. `OVER_ALLOCATED` has no server equivalent. The endpoint's `status` tops out at `PAID`,
 *     so more allocated than the certificate is worth reads as fully settled. C17 (#14) is
 *     fixed, but receipts allocated while it was open can still be in that state.
 *  2. It is measured against the `netCertified` on `GET /ipc/:id`, the figure shown beside it
 *     on this screen. Taking the total from one response and the net from another is how the
 *     two silently drift apart.
 *
 * ─── Money stays a string ───────────────────────────────────────────────────────
 *
 * `totalAllocated` was once a JS `number` — the one money field on the API that was not a
 * decimal string (C8, recorded on issue #14). It is a string now, like every other. It is
 * parsed to integer minor units once, here.
 *
 * The previous version of this file guarded with `Number.isFinite(totalAllocated)`, which
 * returns `false` for a string and silently reported every certificate as `UNPAID`. Do not
 * reintroduce a numeric guard: parse the string.
 */

export type SettlementState = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' | 'OVER_ALLOCATED';

export interface Settlement {
  state: SettlementState;
  /** Sum of allocations against this certificate, in minor units. */
  allocatedMinor: number;
  /** What the client owes on this certificate — net of deductions — in minor units. */
  netMinor: number;
  /** Still owed. Negative when more has been allocated than the certificate is worth. */
  outstandingMinor: number;
}

/**
 * Both arguments are decimal strings: `netCertified` from `GET /ipc/:id`, `totalAllocated`
 * from the payment-status endpoint. Pass `null` for `totalAllocated` while it is loading or
 * if the call failed — the result is then `UNPAID` with nothing allocated, which reads as
 * "no payment recorded" rather than inventing one.
 */
export function settlementFor(netCertified: string, totalAllocated: string | null): Settlement {
  const netMinor = toMinorUnits(netCertified, MONEY_SCALE);
  const allocatedMinor = totalAllocated === null ? 0 : toMinorUnits(totalAllocated, MONEY_SCALE);

  const outstandingMinor = netMinor - allocatedMinor;

  return {
    state: stateFor(allocatedMinor, netMinor),
    allocatedMinor,
    netMinor,
    outstandingMinor,
  };
}

/**
 * Does the certificate's stored gross agree with the sum of its own items?
 *
 * `certifiedTotal` is stored exactly as the client sent it and is never checked against the
 * items the server itself priced — that is C1, issue #12. `totalCertifiedAmount` is that
 * item sum, computed server-side in `Decimal`. The two can disagree, and where they do the
 * item sum is the defensible figure.
 *
 * The UI surfaces the disagreement rather than quietly picking a side: a certificate whose
 * header total does not match its own lines is a document someone needs to look at, not a
 * rounding detail to smooth over. Returns `null` when they agree.
 */
export function grossDisagreementMinor(
  certifiedTotal: string,
  totalCertifiedAmount: string,
): number | null {
  const stated = toMinorUnits(certifiedTotal, MONEY_SCALE);
  const summed = toMinorUnits(totalCertifiedAmount, MONEY_SCALE);

  return stated === summed ? null : stated - summed;
}

function stateFor(allocatedMinor: number, netMinor: number): SettlementState {
  // Over-allocation is not hypothetical. C17 (#14) accepts a negative allocation, which
  // frees headroom for later ones; removing the negative afterwards leaves the total above
  // what was owed and nothing on the server re-checks it. Receipts are in that state now,
  // so a certificate can genuinely show more allocated against it than it is worth.
  if (allocatedMinor > netMinor) return 'OVER_ALLOCATED';

  // Exact settlement requires something to have been owed in the first place. A zero-net
  // certificate with nothing allocated is not "paid" — there was never anything to pay.
  if (allocatedMinor === netMinor && netMinor > 0) return 'PAID';

  return allocatedMinor > 0 ? 'PARTIALLY_PAID' : 'UNPAID';
}
