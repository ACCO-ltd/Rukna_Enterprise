import { describe, expect, it } from 'vitest';
import type { DailyProgressReportResponse } from '@erp/types';

import { canRemoveEntry, isEditableDpr, localIsoDate, myReports, sortMyReports } from './my-reports';

const r = (id: string, reportDate: string, status: DailyProgressReportResponse['status'], preparedBy = 'me') =>
  ({ id, projectId: 'p', reportDate, status, preparedBy }) as DailyProgressReportResponse;

describe('my reports', () => {
  it('keeps only the reports this user prepared', () => {
    const all = [r('a', '2026-09-01', 'DRAFT'), r('b', '2026-09-02', 'DRAFT', 'someone')];
    expect(myReports(all, 'me').map((x) => x.id)).toEqual(['a']);
    expect(myReports(all, null)).toEqual([]);
  });

  it('puts reports needing my action first (returned, draft, reopened), newest first within each group', () => {
    const sorted = sortMyReports([
      r('approved-new', '2026-09-27', 'APPROVED'),
      r('draft-old', '2026-09-20', 'DRAFT'),
      r('submitted', '2026-09-26', 'SUBMITTED'),
      r('returned', '2026-09-22', 'RETURNED'),
      r('reopened', '2026-09-21', 'REOPENED'),
    ]);
    expect(sorted.map((x) => x.id)).toEqual(['returned', 'reopened', 'draft-old', 'approved-new', 'submitted']);
  });

  it('treats draft, returned and reopened as editable', () => {
    expect(isEditableDpr('DRAFT')).toBe(true);
    expect(isEditableDpr('RETURNED')).toBe(true);
    expect(isEditableDpr('REOPENED')).toBe(true);
    expect(isEditableDpr('SUBMITTED')).toBe(false);
    expect(isEditableDpr('APPROVED')).toBe(false);
  });

  it('removal: any entry on a draft or returned report; none once submitted or approved', () => {
    const entry = { createdAt: '2026-09-20T10:00:00.000Z' };
    expect(canRemoveEntry({ status: 'DRAFT' }, entry)).toBe(true);
    expect(canRemoveEntry({ status: 'RETURNED' }, entry)).toBe(true);
    expect(canRemoveEntry({ status: 'SUBMITTED' }, entry)).toBe(false);
    expect(canRemoveEntry({ status: 'APPROVED' }, entry)).toBe(false);
  });

  it('removal on a reopened report: only entries recorded strictly after the reopen (the server rule)', () => {
    const report = { status: 'REOPENED' as const, reopenedAt: '2026-09-20T10:00:00.000Z' };
    expect(canRemoveEntry(report, { createdAt: '2026-09-18T08:00:00.000Z' })).toBe(false);
    expect(canRemoveEntry(report, { createdAt: '2026-09-20T10:00:00.000Z' })).toBe(false); // equal = approved
    expect(canRemoveEntry(report, { createdAt: '2026-09-20T10:00:00.001Z' })).toBe(true);
    // No creation date on the entry: assume it was approved, never offer a delete the server refuses.
    expect(canRemoveEntry(report, {})).toBe(false);
  });

  it('formats the local calendar date', () => {
    expect(localIsoDate(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
  });
});
