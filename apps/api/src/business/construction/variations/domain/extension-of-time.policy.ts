/**
 * ADR-026 CONST-VAR-009 (Variations Phase 4) — the pure Extension-of-Time domain.
 *
 * Zero infrastructure (no Prisma, no Nest). It owns two facts the service reads from:
 *
 *  1. `grantedDays` derivation — the whole-day difference previous→new completion date, or null when
 *     the contract had no previous date to diff against (nothing meaningful to subtract from).
 *  2. `contractStateAllowsExtension` — an EoT moves the *contractual* completion date, which is only a
 *     live fact while the contract is in-progress. It is allowed on ACTIVE and FINAL_ACCOUNT_PENDING
 *     and rejected on every terminal / not-yet-executed state (CLOSED / CANCELLED / TERMINATED, and the
 *     pre-execution DRAFT / UNDER_REVIEW / PENDING_SIGNATURE where there is no contractual date yet).
 *
 * Statuses are plain strings (the Prisma ContractStatus members) so the policy is unit-testable
 * without dragging the generated client into a test.
 */

export type ContractStatusValue =
  | 'DRAFT'
  | 'UNDER_REVIEW'
  | 'PENDING_SIGNATURE'
  | 'ACTIVE'
  | 'FINAL_ACCOUNT_PENDING'
  | 'CLOSED'
  | 'CANCELLED'
  | 'TERMINATED';

// A live, in-progress contract whose contractual completion date is a real, movable fact.
const EXTENDABLE: ReadonlySet<ContractStatusValue> = new Set<ContractStatusValue>([
  'ACTIVE',
  'FINAL_ACCOUNT_PENDING',
]);

// Terminal states — the contract is done/dead; its completion date can no longer be moved.
const TERMINAL: ReadonlySet<ContractStatusValue> = new Set<ContractStatusValue>([
  'CLOSED',
  'CANCELLED',
  'TERMINATED',
]);

export const ExtensionOfTimePolicy = {
  /** An EoT is only valid while the contract is live (ACTIVE / FINAL_ACCOUNT_PENDING). */
  contractStateAllowsExtension(status: ContractStatusValue): boolean {
    return EXTENDABLE.has(status);
  },

  /** Whether the rejection is because the contract is terminal (CLOSED / CANCELLED / TERMINATED). */
  isTerminal(status: ContractStatusValue): boolean {
    return TERMINAL.has(status);
  },
} as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * CONST-VAR-009 — derive the granted days: the whole-day difference between the previous and new
 * completion dates. Null when there was no previous date (nothing to diff against). Both dates are
 * `@db.Date` (midnight UTC), so a plain UTC-day subtraction is exact — no timezone drift and no
 * rounding needed. A negative result is preserved (bringing the date forward is a legal, if unusual,
 * act and must be reported truthfully, not clamped).
 */
export function deriveGrantedDays(
  previousEndDate: Date | null | undefined,
  newEndDate: Date,
): number | null {
  if (previousEndDate === null || previousEndDate === undefined) return null;
  const prevUtc = Date.UTC(
    previousEndDate.getUTCFullYear(),
    previousEndDate.getUTCMonth(),
    previousEndDate.getUTCDate(),
  );
  const newUtc = Date.UTC(
    newEndDate.getUTCFullYear(),
    newEndDate.getUTCMonth(),
    newEndDate.getUTCDate(),
  );
  return Math.round((newUtc - prevUtc) / MS_PER_DAY);
}
