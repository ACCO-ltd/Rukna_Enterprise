import type { ProgressActualPoint } from '@erp/types';

import {
  assessSchedule,
  computeProvisionalBaseline,
  plannedPercentAtDate,
  SCHEDULE_ON_TRACK_BAND,
} from './progress-curve.js';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const actual = (periodEndDate: string, physicalPercent: number): ProgressActualPoint => ({
  periodEndDate,
  physicalPercent,
  verifiedPercent: physicalPercent,
  costPercent: null,
});

describe('progress-curve — provisional Option-C baseline', () => {
  it('is empty when the project has no start or end date', () => {
    expect(computeProvisionalBaseline(null, d('2026-12-31'), [d('2026-06-30')])).toEqual([]);
    expect(computeProvisionalBaseline(d('2026-01-01'), null, [d('2026-06-30')])).toEqual([]);
  });

  it('is empty when end is not after start', () => {
    expect(computeProvisionalBaseline(d('2026-06-01'), d('2026-06-01'), [d('2026-06-01')])).toEqual([]);
    expect(computeProvisionalBaseline(d('2026-06-01'), d('2026-05-01'), [d('2026-06-01')])).toEqual([]);
  });

  it('ramps 0 → 100 linearly and samples at the supplied dates', () => {
    // Jan 1 → Dec 31 2026 (365-day span). Mid-year ≈ 50%.
    const pts = computeProvisionalBaseline(d('2026-01-01'), d('2026-12-31'), [
      d('2026-01-01'),
      d('2026-07-02'),
      d('2026-12-31'),
    ]);
    expect(pts[0]).toEqual({ periodEndDate: '2026-01-01', plannedPercent: 0 });
    expect(pts[1].plannedPercent).toBeGreaterThan(48);
    expect(pts[1].plannedPercent).toBeLessThan(52);
    expect(pts[2]).toEqual({ periodEndDate: '2026-12-31', plannedPercent: 100 });
  });

  it('clamps before start (0) and after end (100)', () => {
    const pts = computeProvisionalBaseline(d('2026-06-01'), d('2026-07-01'), [
      d('2026-01-01'),
      d('2026-09-01'),
    ]);
    expect(pts[0].plannedPercent).toBe(0);
    expect(pts[1].plannedPercent).toBe(100);
  });
});

describe('progress-curve — plannedPercentAtDate', () => {
  it('null without usable dates', () => {
    expect(plannedPercentAtDate(null, null, d('2026-06-01'))).toBeNull();
    expect(plannedPercentAtDate(d('2026-06-01'), d('2026-06-01'), d('2026-06-01'))).toBeNull();
  });
  it('interpolates and clamps', () => {
    expect(plannedPercentAtDate(d('2026-01-01'), d('2026-12-31'), d('2025-01-01'))).toBe(0);
    expect(plannedPercentAtDate(d('2026-01-01'), d('2026-12-31'), d('2027-01-01'))).toBe(100);
    const mid = plannedPercentAtDate(d('2026-01-01'), d('2026-12-31'), d('2026-07-02'));
    expect(mid).toBeGreaterThan(48);
    expect(mid).toBeLessThan(52);
  });
});

describe('progress-curve — assessSchedule', () => {
  const start = d('2026-01-01');
  const end = d('2026-12-31');

  it('INSUFFICIENT_DATA when there are no actuals', () => {
    expect(assessSchedule([], start, end)).toEqual({
      scheduleVariancePercent: null,
      status: 'INSUFFICIENT_DATA',
    });
  });

  it('INSUFFICIENT_DATA when there is no usable baseline', () => {
    expect(assessSchedule([actual('2026-07-02', 50)], null, end).status).toBe('INSUFFICIENT_DATA');
  });

  it('BEHIND when the latest actual trails planned by more than the band', () => {
    // Mid-year planned ≈ 50%; actual 20% → variance ≈ −30 (< −band).
    const r = assessSchedule([actual('2026-04-01', 10), actual('2026-07-02', 20)], start, end);
    expect(r.status).toBe('BEHIND');
    expect(r.scheduleVariancePercent).toBeLessThan(-SCHEDULE_ON_TRACK_BAND);
  });

  it('AHEAD when the latest actual leads planned by more than the band', () => {
    const r = assessSchedule([actual('2026-07-02', 90)], start, end);
    expect(r.status).toBe('AHEAD');
    expect(r.scheduleVariancePercent).toBeGreaterThan(SCHEDULE_ON_TRACK_BAND);
  });

  it('ON_TRACK within the band, and uses the LATEST actual point', () => {
    // Latest at mid-year, planned ≈ 50; actual 50 → variance ≈ 0.
    const r = assessSchedule([actual('2026-02-01', 5), actual('2026-07-02', 50)], start, end);
    expect(r.status).toBe('ON_TRACK');
    expect(Math.abs(r.scheduleVariancePercent!)).toBeLessThanOrEqual(SCHEDULE_ON_TRACK_BAND);
  });
});
