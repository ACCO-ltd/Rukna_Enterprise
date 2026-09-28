import { describe, expect, it } from 'vitest';
import type { DailyProgressReportResponse } from '@erp/types';

import { isEditableDpr, localIsoDate, myReports, sortMyReports } from './my-reports';

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

  it('formats the local calendar date', () => {
    expect(localIsoDate(new Date(2026, 8, 5, 23, 30))).toBe('2026-09-05');
  });
});
