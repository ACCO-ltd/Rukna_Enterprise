import { describe, expect, it } from 'vitest';

import {
  availablePresets,
  buildRange,
  projectToDateStart,
  startsInFuture,
  toLocalIso,
} from './finance-period';

/**
 * The reporting range a Finance screen defaults to.
 *
 * These tests exist because of a specific defect: the Project P&L defaulted to 1 January of the
 * current calendar year and called the result "the project's P&L". On a multi-year job that
 * silently discarded everything before January, and the calendar year is not even the
 * accounting year — the fiscal calendar is configurable.
 */
describe('projectToDateStart', () => {
  it('anchors on the project start date when there is one', () => {
    expect(projectToDateStart('2024-05-17T00:00:00.000Z')).toBe('2024-05-17');
  });

  /**
   * A range that is too wide reports the truth; one that is too narrow hides it. Without a start
   * date the fallback goes back far enough to include any posting the project could have.
   */
  it('falls back to a window wide enough to contain the whole project', () => {
    const start = projectToDateStart(null);
    const year = Number(start.slice(0, 4));
    expect(year).toBeLessThanOrEqual(new Date().getFullYear() - 10);
  });
});

describe('buildRange', () => {
  it('project to date runs from the project start to today', () => {
    const range = buildRange('PROJECT_TO_DATE', { projectStartDate: '2025-03-01' });
    expect(range.fromDate).toBe('2025-03-01');
    expect(range.toDate).toBe(toLocalIso(new Date()));
  });

  it('this period uses the accounting period the backend resolved', () => {
    const range = buildRange('CURRENT_PERIOD', {
      currentPeriodStart: '2026-09-01',
      currentPeriodEnd: '2026-09-30',
    });
    expect(range.fromDate).toBe('2026-09-01');
    expect(range.toDate).toBe('2026-09-30');
  });

  /** The regression guard: never silently fall back to 1 January. */
  it('fiscal year to date never guesses the calendar year', () => {
    const range = buildRange('FISCAL_YTD', { currentPeriodStart: '2026-04-01' });
    expect(range.fromDate).toBe('2026-04-01');
    expect(range.fromDate).not.toMatch(/-01-01$/);
  });
});

describe('availablePresets', () => {
  /** A "this period" option that silently means "today" is worse than no option. */
  it('offers only the presets the backend can actually resolve', () => {
    expect(availablePresets({})).toEqual(['PROJECT_TO_DATE', 'CUSTOM']);
    expect(availablePresets({ currentPeriodStart: '2026-09-01' })).toEqual([
      'PROJECT_TO_DATE',
      'CURRENT_PERIOD',
      'FISCAL_YTD',
      'CUSTOM',
    ]);
  });
});

/**
 * A planned project whose start date is still in the future produced a range running from that
 * start to today — `from` after `to`. Every report over it comes back empty, and the screen then
 * says "nothing has been posted" when the truth is "this project has not started".
 */
describe('a range never runs backwards', () => {
  const future = toLocalIso(new Date(Date.now() + 30 * 86_400_000));

  it('clamps a future project start rather than inverting the range', () => {
    const range = buildRange('PROJECT_TO_DATE', { projectStartDate: future });
    expect(range.fromDate <= range.toDate).toBe(true);
  });

  it('reports that the project has not started, so the screen can say so', () => {
    expect(startsInFuture(future)).toBe(true);
    expect(startsInFuture('2020-01-01')).toBe(false);
    expect(startsInFuture(null)).toBe(false);
  });
});
