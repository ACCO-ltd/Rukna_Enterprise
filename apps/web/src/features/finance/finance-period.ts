/**
 * The date range a Finance screen is reporting over.
 *
 * **Project to date is the default, not calendar year-to-date.** A project manager asking what a
 * project has earned means over its life; the old Project P&L defaulted to 1 January of the
 * current year, which silently truncated every multi-year job and presented the remainder as the
 * project's P&L. Calendar YTD is not even the accounting year — the fiscal calendar is
 * configurable — so it was wrong twice.
 */
export type FinancePeriodPreset = 'PROJECT_TO_DATE' | 'CURRENT_PERIOD' | 'FISCAL_YTD' | 'CUSTOM';

export interface FinanceRange {
  preset: FinancePeriodPreset;
  fromDate: string;
  toDate: string;
}

/** `yyyy-MM-dd` in local time. Never `toISOString`, which shifts the day west of Greenwich. */
export function toLocalIso(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * The earliest date a project's accounting could reach.
 *
 * Anchored on the project's own start date when it has one, so "project to date" means what it
 * says. Without one it falls back far enough to include any posting the project could have — a
 * range that is too wide reports the truth; one that is too narrow hides it.
 */
export function projectToDateStart(projectStartDate: string | null | undefined): string {
  if (projectStartDate) return projectStartDate.slice(0, 10);
  const today = new Date();
  return toLocalIso(new Date(today.getFullYear() - 10, 0, 1));
}

export function buildRange(
  preset: FinancePeriodPreset,
  context: {
    projectStartDate?: string | null;
    /** The accounting period covering today, when the backend resolved one. */
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    /** The active fiscal year's start, when known. */
    fiscalYearStart?: string | null;
  },
): FinanceRange {
  const today = toLocalIso(new Date());

  switch (preset) {
    case 'CURRENT_PERIOD':
      return {
        preset,
        fromDate: context.currentPeriodStart ?? today,
        toDate: context.currentPeriodEnd ?? today,
      };
    case 'FISCAL_YTD':
      return {
        preset,
        // Without a resolved fiscal year, fall back to the current period's start rather than to
        // 1 January: guessing the calendar year is the defect this replaces.
        fromDate: context.fiscalYearStart ?? context.currentPeriodStart ?? today,
        toDate: today,
      };
    case 'PROJECT_TO_DATE':
    case 'CUSTOM':
    default:
      return {
        preset,
        fromDate: projectToDateStart(context.projectStartDate),
        toDate: today,
      };
  }
}

/** Which presets can be offered, given what the backend actually resolved. */
export function availablePresets(context: {
  currentPeriodStart?: string | null;
  fiscalYearStart?: string | null;
}): FinancePeriodPreset[] {
  const presets: FinancePeriodPreset[] = ['PROJECT_TO_DATE'];
  // Offered only when a period actually exists. A "this period" option that silently means
  // "today" is worse than no option.
  if (context.currentPeriodStart) presets.push('CURRENT_PERIOD');
  if (context.fiscalYearStart ?? context.currentPeriodStart) presets.push('FISCAL_YTD');
  presets.push('CUSTOM');
  return presets;
}
