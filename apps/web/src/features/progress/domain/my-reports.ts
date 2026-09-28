import type { DailyProgressReportResponse } from '@erp/types';

type Status = DailyProgressReportResponse['status'];

/** Statuses where the preparer has the next move: fix, finish, or correct and resubmit. */
const NEEDS_MY_ACTION: ReadonlySet<Status> = new Set<Status>(['RETURNED', 'DRAFT', 'REOPENED']);

/** A report the preparer can still edit (and resubmit). */
export function isEditableDpr(status: Status): boolean {
  return NEEDS_MY_ACTION.has(status);
}

/** The reports this user prepared. Derived client-side from the project list (owner-approved). */
export function myReports(
  reports: DailyProgressReportResponse[],
  userId: string | null | undefined,
): DailyProgressReportResponse[] {
  if (!userId) return [];
  return reports.filter((r) => r.preparedBy === userId);
}

/**
 * "My reports" order: everything waiting on me (returned, draft, reopened) first, then the rest;
 * newest report date first within each group.
 */
export function sortMyReports(reports: DailyProgressReportResponse[]): DailyProgressReportResponse[] {
  return [...reports].sort((a, b) => {
    const actionA = NEEDS_MY_ACTION.has(a.status) ? 0 : 1;
    const actionB = NEEDS_MY_ACTION.has(b.status) ? 0 : 1;
    if (actionA !== actionB) return actionA - actionB;
    return b.reportDate.localeCompare(a.reportDate);
  });
}

/** The calendar date in the viewer's own timezone, as `YYYY-MM-DD` — "today" on site, not in UTC. */
export function localIsoDate(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
