import { describe, expect, it } from 'vitest';

import { makeClosedPeriodPredicate, periodCovering } from './open-period';
import type { AccountingPeriod, FiscalYear, PeriodStatus } from './types';

function period(name: string, startDate: string, endDate: string, status: PeriodStatus): AccountingPeriod {
  return {
    id: name,
    fiscalYearId: 'fy-2026',
    organizationId: 'org-1',
    periodNumber: Number(name.slice(-2)),
    name,
    startDate,
    endDate,
    periodType: 'OPERATING',
    status,
    reopenReason: null,
    reopenedBy: null,
    reopenedAt: null,
  } as AccountingPeriod;
}

function year(periods: AccountingPeriod[]): FiscalYear {
  return { id: 'fy-2026', name: '2026', periods } as FiscalYear;
}

const JAN = period('2026-01', '2026-01-01', '2026-01-31', 'CLOSED');
const FEB = period('2026-02', '2026-02-01', '2026-02-28', 'REOPENED');
const MAR = period('2026-03', '2026-03-01', '2026-03-31', 'LOCKED');
const APR = period('2026-04', '2026-04-01', '2026-04-30', 'OPEN');

const refuses = makeClosedPeriodPredicate([year([JAN, FEB, MAR, APR])]);

/** Local midnight, matching how the picker hands dates to the predicate. */
const on = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y as number, (m as number) - 1, d as number);
};

describe('periodCovering', () => {
  it('matches on the inclusive boundaries of a period', () => {
    const periods = [JAN, FEB];
    expect(periodCovering(periods, '2026-01-01')?.name).toBe('2026-01');
    expect(periodCovering(periods, '2026-01-31')?.name).toBe('2026-01');
    expect(periodCovering(periods, '2026-02-01')?.name).toBe('2026-02');
  });

  it('tolerates full ISO timestamps from the API', () => {
    const withTime = period('2026-05', '2026-05-01T00:00:00.000Z', '2026-05-31T23:59:59.000Z', 'OPEN');
    expect(periodCovering([withTime], '2026-05-15')?.name).toBe('2026-05');
  });
});

describe('makeClosedPeriodPredicate', () => {
  it('accepts OPEN and REOPENED, refuses LOCKED and CLOSED', () => {
    expect(refuses(on('2026-04-15'))).toBe(false); // OPEN
    // Reopening a period is how a correction gets in; refusing its dates would defeat that.
    expect(refuses(on('2026-02-15'))).toBe(false); // REOPENED
    // LOCKED is mid-close, not final — but it still takes no new postings.
    expect(refuses(on('2026-03-15'))).toBe(true);
    expect(refuses(on('2026-01-15'))).toBe(true); // CLOSED
  });

  it('refuses a date no period covers at all', () => {
    // 2027 has no fiscal year yet. A posting there would never be seen by a period close.
    expect(refuses(on('2027-01-15'))).toBe(true);
  });

  it('refuses nothing while the fiscal years are still loading', () => {
    // A form that greys out every date because a query has not resolved reads as broken, and
    // the server enforces the rule regardless.
    expect(makeClosedPeriodPredicate(undefined)(on('2026-01-15'))).toBe(false);
    expect(makeClosedPeriodPredicate([])(on('2026-01-15'))).toBe(false);
  });

  it('reads the date in local time, not UTC', () => {
    // `toISOString()` on a local-midnight Date west of Greenwich yields the previous day, which
    // would make the last day of a closed period look open (and vice versa).
    expect(refuses(on('2026-04-01'))).toBe(false);
    expect(refuses(on('2026-03-31'))).toBe(true);
  });
});
