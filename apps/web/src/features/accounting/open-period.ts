import type { AccountingPeriod, FiscalYear } from './types';

/**
 * Which dates a posting may carry.
 *
 * ─── Why the calendar needs this and `min`/`max` did not suffice ─────────────────
 *
 * A posting date has to fall inside a period that is still OPEN or REOPENED. That is not a
 * range: periods are closed one at a time and a reopened month can sit between two closed
 * ones, so the set of legal dates has holes in it. A native `<input type="date">` could only
 * ever express `min` and `max`, which is why this rule used to be enforced nowhere in the UI
 * and only surfaced as a rejected request after the user had filled the whole form in.
 *
 * ─── LOCKED is not OPEN ──────────────────────────────────────────────────────────
 *
 * `PeriodStatus` has four values and only two of them accept a posting. LOCKED is the state a
 * period enters while it is being closed — it stops new entries without being final — and
 * CLOSED is final. REOPENED is deliberately postable: reopening a period is how a correction
 * gets in, and refusing dates in it would defeat the reason it was reopened.
 */
const POSTABLE = new Set(['OPEN', 'REOPENED']);

/** `yyyy-MM-dd` in local time. Never `toISOString`, which shifts the day west of Greenwich. */
function toLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** The period whose span contains this date, or undefined when no period covers it. */
export function periodCovering(
  periods: readonly AccountingPeriod[],
  isoDate: string,
): AccountingPeriod | undefined {
  return periods.find(
    (period) => period.startDate.slice(0, 10) <= isoDate && isoDate <= period.endDate.slice(0, 10),
  );
}

/**
 * Build the predicate a DatePicker takes: true when the date must be refused.
 *
 * A date that no period covers at all is refused too. That is the year nobody has opened yet,
 * and posting into it would create a transaction the period-close process never sees.
 *
 * With no fiscal years loaded the predicate refuses nothing. Blocking every date because a
 * query has not resolved would look like a broken form, and the server still enforces the
 * rule — this is a guard rail, not the gate.
 */
export function makeClosedPeriodPredicate(
  fiscalYears: readonly FiscalYear[] | undefined,
): (date: Date) => boolean {
  const periods = (fiscalYears ?? []).flatMap((year) => year.periods ?? []);
  if (periods.length === 0) return () => false;

  return (date: Date) => {
    const period = periodCovering(periods, toLocalIso(date));
    return !period || !POSTABLE.has(period.status);
  };
}
