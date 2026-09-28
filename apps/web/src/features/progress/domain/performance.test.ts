import { describe, expect, it } from 'vitest';

import { contributionPoints, curveCsv, packagePlannedPercent, planPosition, plannedPercentAt } from './performance';

const CURVE = [
  { periodEndDate: '2026-01-31', plannedPercent: 10 },
  { periodEndDate: '2026-03-31', plannedPercent: 40 },
  { periodEndDate: '2026-06-30', plannedPercent: 100 },
];

describe('plannedPercentAt', () => {
  it('is null without a curve', () => {
    expect(plannedPercentAt([], '2026-02-01')).toBeNull();
  });

  it('interpolates between points and holds at the ends', () => {
    expect(plannedPercentAt(CURVE, '2026-01-31')).toBe(10);
    expect(plannedPercentAt(CURVE, '2026-03-01')).toBeCloseTo(24.7, 1);
    expect(plannedPercentAt(CURVE, '2026-09-01')).toBe(100);
  });

  it('is null before the plan starts — not started is not 0% planned', () => {
    expect(plannedPercentAt(CURVE, '2025-12-01')).toBeNull();
  });

  it('accepts unsorted points and collapses same-date points to the later one', () => {
    const unsorted = [CURVE[2]!, CURVE[0]!, CURVE[1]!];
    expect(plannedPercentAt(unsorted, '2026-03-31')).toBe(40);
    expect(plannedPercentAt(unsorted, '2026-03-01')).toBeCloseTo(24.7, 1);
    const sameDate = [
      { periodEndDate: '2026-01-31', plannedPercent: 10 },
      { periodEndDate: '2026-01-31', plannedPercent: 15 },
      { periodEndDate: '2026-02-28', plannedPercent: 50 },
    ];
    expect(plannedPercentAt(sameDate, '2026-01-31')).toBe(15);
    expect(plannedPercentAt(sameDate, '2026-02-28')).toBe(50);
  });
});

describe('packagePlannedPercent', () => {
  it('spreads the plan evenly between planned start and end', () => {
    expect(packagePlannedPercent('2026-01-01', '2026-01-11', '2026-01-06')).toBe(50);
    expect(packagePlannedPercent('2026-01-01', '2026-01-11', '2025-12-01')).toBe(0);
    expect(packagePlannedPercent('2026-01-01', '2026-01-11', '2026-02-01')).toBe(100);
  });

  it('is null without both dates', () => {
    expect(packagePlannedPercent(null, '2026-01-11', '2026-01-06')).toBeNull();
    expect(packagePlannedPercent('2026-01-01', null, '2026-01-06')).toBeNull();
  });
});

describe('contributionPoints / planPosition', () => {
  it('multiplies weight by % done', () => {
    expect(contributionPoints('0.25', 60)).toBe(15);
    expect(contributionPoints('0.3333', 50)).toBe(16.7);
    expect(contributionPoints('0.2', null)).toBeNull();
  });

  it('reads within half a point as on plan', () => {
    expect(planPosition(-3)).toBe('behind');
    expect(planPosition(0.4)).toBe('on');
    expect(planPosition(2)).toBe('ahead');
  });
});

describe('curveCsv', () => {
  it('writes one row per date with blanks where a series has no point', () => {
    const csv = curveCsv(
      [{ periodEndDate: '2026-01-31', plannedPercent: 10 }],
      [{ periodEndDate: '2026-02-15', physicalPercent: 20, verifiedPercent: 18, costPercent: null }],
      { date: 'Date', planned: 'Planned %', verified: 'Verified %' },
    );
    expect(csv).toBe('Date,Planned %,Verified %\n2026-01-31,10,\n2026-02-15,,18\n');
  });
});
