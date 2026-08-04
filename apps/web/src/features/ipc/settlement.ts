import { toMinorUnits } from '@/features/receipts/allocation';

/**
 * ─── How much of a certificate has been paid ────────────────────────────────────
 *
 * The API has an endpoint for exactly this — `GET /receipts/certificate/:id/payment-status`
 * — and half of its answer is wrong. This module takes the half that is right and computes
 * the rest.
 *
 * **What the endpoint gets right:** `totalAllocated`, the sum of every allocation against
 * the certificate. That sum is computed in the database and is correct.
 *
 * **What it gets wrong:** `status`. It compares `totalAllocated` against the certificate's
 * GROSS `certifiedTotal` rather than its `netCertified`. A client pays the net — gross minus
 * retention, advance recovery and tax — so on any certificate carrying a deduction the
 * comparison can never succeed and the status is pinned at `PARTIALLY_PAID` forever. A 5%
 * retention makes `PAID` unreachable. That is C7, issue #11.
 *
 * So we take `totalAllocated` and compare it ourselves against `netCertified`, which
 * `GET /ipc/:id` already computes and returns. The result is correct today and does not
 * change when #11 is fixed — at which point `status` becomes a redundant second opinion
 * rather than something to migrate to.
 *
 * ─── The one place a float touches money on this screen ─────────────────────────
 *
 * `totalAllocated` arrives as a JS `number`, not a decimal string like every other money
 * field on the API (C8, recorded on issue #14). There is no string to preserve, so it is
 * converted to integer minor units once, here, and never used as a float again.
 *
 * This is safe rather than merely tolerable: the server sums in `Decimal` and converts once,
 * and a two-decimal value stays exact in a `double` until roughly 9e13 — five orders of
 * magnitude above ACCO's largest contract. Do not "fix" this into a string parse; the API
 * does not send a string.
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
 * `netCertified` is the decimal string from `GET /ipc/:id`; `totalAllocated` is the number
 * from the payment-status endpoint. Pass `null` for `totalAllocated` while it is loading or
 * if the call failed — the result is then `UNPAID` with nothing allocated, which reads as
 * "no payment recorded" rather than inventing one.
 */
export function settlementFor(netCertified: string, totalAllocated: number | null): Settlement {
  const netMinor = toMinorUnits(netCertified);
  const allocatedMinor =
    totalAllocated === null || !Number.isFinite(totalAllocated)
      ? 0
      : Math.round(totalAllocated * 100);

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
  const stated = toMinorUnits(certifiedTotal);
  const summed = toMinorUnits(totalCertifiedAmount);

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
