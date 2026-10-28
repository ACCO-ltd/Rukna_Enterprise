import type { AgingBucketKey } from '@erp/types';

/** Whole days `due` is behind `today` (both YYYY-MM-DD dates); 0 or less = not yet due. */
export function daysPastDue(due: Date, today: Date): number {
  const day = 86_400_000;
  const d = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const t = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((t - d) / day);
}

/** The aging bucket for days past due: current (not due), 1–30, 31–60, 61–90, over 90. */
export function agingBucket(daysLate: number): AgingBucketKey {
  if (daysLate <= 0) return 'current';
  if (daysLate <= 30) return 'd1_30';
  if (daysLate <= 60) return 'd31_60';
  if (daysLate <= 90) return 'd61_90';
  return 'd90_plus';
}

export const AGING_ORDER: readonly AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

/** First and last day of `today`'s month, as UTC dates. */
export function monthBounds(today: Date): { from: Date; to: Date } {
  const from = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const to = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
  return { from, to };
}
