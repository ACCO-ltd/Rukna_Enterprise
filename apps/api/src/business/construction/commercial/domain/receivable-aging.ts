import type { CommercialAgingBucket } from '@erp/types';

/**
 * The one receivables-aging rule, shared by the Commercial billing read model
 * (`GET /projects/:id/commercial/billing`) and the Dashboard (`GET /dashboard`), so the two can
 * never bucket the same invoice differently.
 *
 * `daysLate` is whole UTC days past due — always from `daysPastDue` (commercial redesign D5, the
 * one overdue rule): ≤ 0 is not yet due.
 */
export type AgingBucket = CommercialAgingBucket['bucket'];

export const AGING_BUCKETS: ReadonlyArray<AgingBucket> = [
  'NOT_DUE',
  'DAYS_1_30',
  'DAYS_31_60',
  'DAYS_61_90',
  'DAYS_90_PLUS',
];

export function agingBucket(daysLate: number): AgingBucket {
  if (daysLate <= 0) return 'NOT_DUE';
  if (daysLate <= 30) return 'DAYS_1_30';
  if (daysLate <= 60) return 'DAYS_31_60';
  if (daysLate <= 90) return 'DAYS_61_90';
  return 'DAYS_90_PLUS';
}
