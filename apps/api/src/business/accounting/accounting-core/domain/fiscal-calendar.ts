/**
 * Fiscal-year calendar math — the ONE place a fiscal year's dates and monthly periods are derived.
 *
 * Used by `FiscalYearService.create` and by the one-step accounting setup (ADR-040), so the two
 * can never disagree about where a year starts, ends, or how its twelve periods are cut.
 *
 * Dates are built in UTC. The columns are `@db.Date`, and Prisma writes a Date's UTC calendar day:
 * a local-time `new Date(2026, 0, 1)` on a server east of Greenwich is 2025-12-31T21:00Z and would
 * be stored as 31 December.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const;

export interface FiscalPeriodPlan {
  periodNumber: number;
  name: string;
  startDate: Date;
  endDate: Date;
  periodType: 'OPERATING';
  status: 'OPEN';
}

export interface FiscalYearPlan {
  name: string;
  startDate: Date;
  endDate: Date;
  periods: FiscalPeriodPlan[];
}

/** `FY2026` for a calendar year; `FY2026/27` for a year that starts in any other month. */
export function fiscalYearName(year: number, startMonth: number): string {
  if (startMonth === 1) return `FY${year}`;
  return `FY${year}/${String((year + 1) % 100).padStart(2, '0')}`;
}

/**
 * The fiscal year that starts on the 1st of `startMonth` (1–12) of `year`, with twelve OPEN
 * monthly periods. A non-January start runs into the next calendar year (April 2026 → March 2027).
 */
export function buildFiscalYearPlan(year: number, startMonth: number): FiscalYearPlan {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new RangeError(`startMonth must be 1..12, got ${startMonth}`);
  }
  const startIndex = startMonth - 1;

  const periods: FiscalPeriodPlan[] = Array.from({ length: 12 }, (_, i) => {
    // Date.UTC normalises month overflow (month 12 → January of the next year).
    const startDate = new Date(Date.UTC(year, startIndex + i, 1));
    const endDate = new Date(Date.UTC(year, startIndex + i + 1, 0));
    const monthIndex = startDate.getUTCMonth();
    return {
      periodNumber: i + 1,
      name: `${MONTH_NAMES[monthIndex]} ${startDate.getUTCFullYear()}`,
      startDate,
      endDate,
      periodType: 'OPERATING' as const,
      status: 'OPEN' as const,
    };
  });

  return {
    name: fiscalYearName(year, startMonth),
    startDate: periods[0]!.startDate,
    endDate: periods[11]!.endDate,
    periods,
  };
}
