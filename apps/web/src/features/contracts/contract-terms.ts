import { ContractStatus, GuaranteeStatus } from '@erp/types';

import type { ContractGuarantee } from './types';

/**
 * ─── Percentages ────────────────────────────────────────────────────────────────
 *
 * Every rate on a contract is a Decimal(5,4) FRACTION, not a percentage figure: a 5%
 * retention rate is stored and transmitted as `"0.0500"`. A human types `5`.
 *
 * Getting this backwards is the single most expensive mistake available on this screen —
 * sending `"5"` where `"0.05"` was meant asks for 500% retention — so the conversion lives
 * in one tested place rather than inline in a form handler.
 *
 * Decimal(5,4) also caps the value: the largest storable fraction is 9.9999, so anything
 * above 999.99% is rejected by the database rather than by us.
 */

/** `"0.0500"` → `"5"`. Trailing zeros are dropped so the field reads cleanly. */
export function fractionToPercent(fraction: string | null | undefined): string {
  if (fraction === null || fraction === undefined || fraction.trim() === '') return '';

  const value = Number(fraction);
  if (!Number.isFinite(value)) return '';

  // Rounded to 2dp because Decimal(5,4) can only express 4 fractional digits, which is
  // 2 decimal places once expressed as a percentage.
  return String(Math.round(value * 10000) / 100);
}

/** `"5"` → `"0.0500"`, padded to the 4 decimal places the column stores. */
export function percentToFraction(percent: string): string {
  const trimmed = percent.trim();
  if (!trimmed) return '';

  const value = Number(trimmed);
  if (!Number.isFinite(value)) return '';

  return (value / 100).toFixed(4);
}

/**
 * True when a typed percentage is a number the Decimal(5,4) column can hold.
 *
 * The empty check is not redundant: `Number('')` is `0`, which is finite and in range, so
 * without it a blank retention rate would validate as "0%" and silently write a contract
 * with no retention at all.
 */
export function isValidPercent(percent: string): boolean {
  const trimmed = percent.trim();
  if (!trimmed) return false;

  const value = Number(trimmed);
  return Number.isFinite(value) && value >= 0 && value <= 100;
}

/**
 * ─── Where terms can still be changed ───────────────────────────────────────────
 *
 * The API enforces NO status gate on any of these operations — `setRetentionTerms`,
 * `addAdvanceTerm`, `addGuarantee` and `addMilestone` all call `requireContract` and
 * nothing else, so the server would happily attach a new advance term to a contract that
 * was cancelled last year.
 *
 * This is a UI guard, not an API rule, and it is deliberately narrow: commercial terms can
 * be set right up to the final account, because retention is released at and after
 * practical completion — that is what `retentionReleasedAt` is for. Only the three endings
 * close the door, and on those the terms remain visible as the historical record of what
 * was agreed.
 */
const TERMS_LOCKED_IN: ContractStatus[] = [
  ContractStatus.CLOSED,
  ContractStatus.CANCELLED,
  ContractStatus.TERMINATED,
];

export function canEditTerms(status: ContractStatus): boolean {
  return !TERMS_LOCKED_IN.includes(status);
}

/**
 * Guarantee status is the exception: a bank guarantee runs on its own clock and is
 * discharged, expires or is called on dates that have nothing to do with the contract's
 * own lifecycle — routinely after the contract has closed. Recording that must stay
 * possible when everything else is locked.
 */
export function canUpdateGuaranteeStatus(): boolean {
  return true;
}

/**
 * ─── Advance terms ──────────────────────────────────────────────────────────────
 *
 * `AddAdvanceTermDto` marks both `amount` and `percentage` optional and enforces no
 * relationship between them, so the API accepts an advance with both, or with neither —
 * and an advance with neither has no value at all, which nothing downstream can price.
 *
 * The form requires exactly one. That is a UI rule filling a gap in the DTO rather than
 * mirroring it, which is why it is stated here rather than buried in a resolver.
 */
export type AdvanceBasis = 'amount' | 'percentage';

export function advanceBasisOf(term: {
  amount: string | null;
  percentage: string | null;
}): AdvanceBasis | null {
  if (term.amount !== null) return 'amount';
  if (term.percentage !== null) return 'percentage';
  return null;
}

/**
 * ─── Guarantee expiry ───────────────────────────────────────────────────────────
 *
 * An expired-but-still-ACTIVE guarantee is the case worth surfacing: the bank's obligation
 * has lapsed while the record still claims cover. The API has no expiry job — the schema
 * indexes `[expiryDate, status]` for one, but nothing writes the transition — so the
 * status stays ACTIVE until a human changes it.
 *
 * `today` is passed in rather than read from the clock so this stays a pure function.
 */
export function isLapsed(guarantee: ContractGuarantee, today: string): boolean {
  return guarantee.status === GuaranteeStatus.ACTIVE && guarantee.expiryDate.slice(0, 10) < today;
}

/** Guarantees whose cover has lapsed without anyone recording it. */
export function lapsedGuarantees(
  guarantees: ContractGuarantee[],
  today: string,
): ContractGuarantee[] {
  return guarantees.filter((g) => isLapsed(g, today));
}
