import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

/**
 * Display arithmetic for the Finance project screens, on `src/lib/money.ts` (integer minor units,
 * never floats). These are the only figures the browser derives — shares and comparisons for
 * display. Every amount itself comes from the API (ADR-043: no second formula).
 */

/** A decimal money string in minor units; absent reads as 0 (for sorting and comparing only). */
export const minor = (value: string | null | undefined): number => toMinorUnits(value, MONEY_SCALE);

/** Whether a money string is present and above zero. */
export const isPositive = (value: string | null | undefined): boolean => minor(value) > 0;

/** Whether a money string is present and exactly zero. */
export const isZero = (value: string | null | undefined): boolean => value !== null && value !== undefined && minor(value) === 0;

/** The unsigned amount as a decimal string — "-200000.00" → "200000.00". */
export const absMoney = (value: string): string => fromMinorUnits(Math.abs(minor(value)), MONEY_SCALE);

/**
 * `part` as a whole-number percent of `whole`, or null when there is no denominator — never a 0%
 * that claims a fact. Both are decimal money strings.
 */
export function share(part: string | null | undefined, whole: string | null | undefined): number | null {
  if (part === null || part === undefined || whole === null || whole === undefined) return null;
  const w = minor(whole);
  if (w <= 0) return null;
  return Math.round((minor(part) * 100) / w);
}

/** `part` as a percent of `whole` for drawing a bar (0–100, unrounded); 0 without a denominator. */
export function barPercent(part: string | null | undefined, whole: string | null | undefined): number {
  const w = minor(whole);
  if (w <= 0) return 0;
  return Math.min(100, Math.max(0, (minor(part) * 100) / w));
}
