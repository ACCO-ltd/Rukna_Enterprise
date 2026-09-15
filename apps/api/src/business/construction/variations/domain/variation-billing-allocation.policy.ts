import { Decimal } from '@prisma/client/runtime/library';

/**
 * ADR-030 CONST-COM-028 (Commercial redesign, variation billing P1) — the pure realization invariant.
 *
 * Carries ZERO infrastructure (no Prisma, no Nest). Amounts are plain Decimals so the policy is
 * unit-testable without the generated client or a database.
 *
 * The model (design doc §7): a variation is an independently-billable unit. ENTITLEMENT (the current
 * contract value raised at adoption) and billing REALIZATION (this ledger) are separate layers. This
 * policy owns realization only — it never touches contract value or the frozen %-schedule.
 *
 * The invariant, in one sentence: the running sum of a VO's allocations moves MONOTONICALLY toward its
 * `netValue`, on the SAME side of zero as `netValue`, and NEVER overshoots it in magnitude; when fully
 * realized the sum EQUALS `netValue` exactly. So:
 *
 *   - a +2,000 addition can be realized by one or many positive allocations, but Σ never exceeds +2,000;
 *   - a −3,000 omission is realized by negative allocations, and Σ never goes below −3,000;
 *   - a mixed-sign realization (a +2,000 slice against a −3,000 VO) is rejected — it moves away from net;
 *   - a fully-realized VO (Σ == netValue) refuses any further nonzero allocation (nothing left to bill).
 *
 * This is the server-side "exactly once" guarantee: no VO dollar can be billed twice, because the
 * remaining headroom shrinks with each allocation and can never be re-expanded past `netValue`.
 */

/** Machine-stable rejection reasons, so the service can map them to a clear domain error. */
export type AllocationRejectionReason =
  | 'ZERO_AMOUNT' // a nonzero slice is required to realize anything
  | 'WRONG_SIGN' // the slice moves away from netValue (or netValue is zero)
  | 'OVERSHOOTS_NET'; // the running sum would exceed netValue in magnitude

export interface AllocationValidation {
  ok: boolean;
  /** Present only when ok === false. */
  reason?: AllocationRejectionReason;
  /**
   * Signed headroom BEFORE this allocation: `netValue − existingSum`. Positive for an under-realized
   * addition, negative for an under-realized omission, zero when already fully realized.
   */
  remainingBefore: Decimal;
  /** Signed headroom AFTER this allocation would be applied (present only when ok === true). */
  remainingAfter?: Decimal;
}

function toDecimal(value: Decimal | string | number): Decimal {
  return value instanceof Decimal ? value : new Decimal(value);
}

/** Σ of a set of allocation amounts, at money precision (2dp). Signed. */
export function sumAllocations(
  allocations: ReadonlyArray<{ amount: Decimal | string | number }>,
): Decimal {
  return allocations
    .reduce((acc, a) => acc.plus(toDecimal(a.amount)), new Decimal(0))
    .toDecimalPlaces(2);
}

export const VariationBillingAllocationPolicy = {
  /**
   * The signed amount of a VO's net still to be realized: `netValue − Σ existing`. Zero ⇔ fully
   * realized. Its SIGN equals `netValue`'s while under-realized (positive for an addition still owed,
   * negative for an omission still owed).
   */
  remainingUnallocated(
    netValue: Decimal | string | number,
    existingAllocations: ReadonlyArray<{ amount: Decimal | string | number }>,
  ): Decimal {
    const net = toDecimal(netValue).toDecimalPlaces(2);
    return net.minus(sumAllocations(existingAllocations)).toDecimalPlaces(2);
  },

  /** A VO is fully realized when its allocations sum exactly to `netValue` (headroom is zero). */
  isFullyRealized(
    netValue: Decimal | string | number,
    existingAllocations: ReadonlyArray<{ amount: Decimal | string | number }>,
  ): boolean {
    return this.remainingUnallocated(netValue, existingAllocations).isZero();
  },

  /**
   * Validate a PROPOSED new allocation of `proposedAmount` against a VO's `netValue` and its existing
   * allocations. Returns `{ ok }` plus the machine reason on rejection and the signed headroom.
   *
   * Rules (all evaluated on 2dp money):
   *   1. ZERO_AMOUNT — a zero slice realizes nothing; reject.
   *   2. WRONG_SIGN — the slice must have the same sign as the REMAINING headroom (which, while under-
   *      realized, has `netValue`'s sign). A +slice against a negative net, a −slice against a positive
   *      net, or ANY slice when netValue is zero or already fully realized, is moving away from net.
   *   3. OVERSHOOTS_NET — the running sum after the slice must not exceed `netValue` in magnitude:
   *      `|existingSum + proposed| ≤ |netValue|`. Equivalently, `|proposed| ≤ |remainingBefore|`.
   */
  validateAllocation(
    netValue: Decimal | string | number,
    existingAllocations: ReadonlyArray<{ amount: Decimal | string | number }>,
    proposedAmount: Decimal | string | number,
  ): AllocationValidation {
    const net = toDecimal(netValue).toDecimalPlaces(2);
    const proposed = toDecimal(proposedAmount).toDecimalPlaces(2);
    const remainingBefore = this.remainingUnallocated(net, existingAllocations);

    if (proposed.isZero()) {
      return { ok: false, reason: 'ZERO_AMOUNT', remainingBefore };
    }

    // WRONG_SIGN: the slice must point the same way as the remaining headroom. If there is no headroom
    // (remainingBefore is zero — netValue zero, or already fully realized), any nonzero slice is wrong.
    if (remainingBefore.isZero() || proposed.isNegative() !== remainingBefore.isNegative()) {
      return { ok: false, reason: 'WRONG_SIGN', remainingBefore };
    }

    // OVERSHOOTS_NET: the magnitude of the slice cannot exceed the magnitude of the remaining headroom.
    if (proposed.abs().greaterThan(remainingBefore.abs())) {
      return { ok: false, reason: 'OVERSHOOTS_NET', remainingBefore };
    }

    return {
      ok: true,
      remainingBefore,
      remainingAfter: remainingBefore.minus(proposed).toDecimalPlaces(2),
    };
  },
} as const;
