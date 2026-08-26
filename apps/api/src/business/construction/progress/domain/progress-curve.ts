// Round-2 Progress-over-time (BE-1) — pure curve/status/variance math. No Prisma, no NestJS: the
// service loads snapshots + project dates and calls these, so the schedule logic is unit-tested
// directly. Everything here is deterministic given its inputs.

import type {
  ProgressActualPoint,
  ProgressCurvePoint,
  ProgressScheduleStatus,
} from '@erp/types';

/** Band (percentage points) inside which actual-vs-planned counts as ON_TRACK, not AHEAD/BEHIND. */
export const SCHEDULE_ON_TRACK_BAND = 5;

const DAY_MS = 24 * 60 * 60 * 1000;

function toDay(date: Date): number {
  return Math.floor(date.getTime() / DAY_MS);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Provisional Option-C baseline for BE-1: a simple linear ramp 0 → 100% from `startDate` to
 * `expectedEndDate`, sampled at each supplied `sampleDate` (the snapshot period-end dates, so the
 * planned line lines up with the actual line the UI draws). Returns [] when the project has no
 * usable dates (missing, or end ≤ start) — the read then reports INSUFFICIENT_DATA.
 *
 * BE-2 SEAM: this whole function is the swappable baseline source. Option-A derives the curve from
 * work-package planned start/finish + weights and freezes it; Option-B stores entered points. Both
 * replace only this producer — the ProgressCurvePoint[] contract and everything downstream stay put.
 */
export function computeProvisionalBaseline(
  startDate: Date | null,
  expectedEndDate: Date | null,
  sampleDates: Date[],
): ProgressCurvePoint[] {
  if (!startDate || !expectedEndDate) return [];
  const start = toDay(startDate);
  const end = toDay(expectedEndDate);
  if (end <= start) return [];
  const span = end - start;
  return sampleDates.map((d) => {
    const day = toDay(d);
    const frac = (day - start) / span;
    const planned = frac <= 0 ? 0 : frac >= 1 ? 100 : frac * 100;
    return { periodEndDate: isoDate(d), plannedPercent: round2(planned) };
  });
}

/** The planned cumulative % at an arbitrary date, linear-interpolated over [start, expectedEnd]. */
export function plannedPercentAtDate(
  startDate: Date | null,
  expectedEndDate: Date | null,
  at: Date,
): number | null {
  if (!startDate || !expectedEndDate) return null;
  const start = toDay(startDate);
  const end = toDay(expectedEndDate);
  if (end <= start) return null;
  const frac = (toDay(at) - start) / (end - start);
  const planned = frac <= 0 ? 0 : frac >= 1 ? 100 : frac * 100;
  return round2(planned);
}

export interface ScheduleAssessment {
  scheduleVariancePercent: number | null;
  status: ProgressScheduleStatus;
}

/**
 * Compares the latest actual physical % to the planned % at that snapshot's date. BEHIND when the
 * actual is below planned by more than the band, AHEAD when above by more than the band, ON_TRACK
 * within it. INSUFFICIENT_DATA when there is no snapshot or no usable baseline.
 */
export function assessSchedule(
  actual: ProgressActualPoint[],
  startDate: Date | null,
  expectedEndDate: Date | null,
): ScheduleAssessment {
  if (actual.length === 0) {
    return { scheduleVariancePercent: null, status: 'INSUFFICIENT_DATA' };
  }
  const latest = actual[actual.length - 1];
  const planned = plannedPercentAtDate(startDate, expectedEndDate, new Date(latest.periodEndDate));
  if (planned === null) {
    return { scheduleVariancePercent: null, status: 'INSUFFICIENT_DATA' };
  }
  const variance = round2(latest.physicalPercent - planned);
  const status: ProgressScheduleStatus =
    variance > SCHEDULE_ON_TRACK_BAND
      ? 'AHEAD'
      : variance < -SCHEDULE_ON_TRACK_BAND
        ? 'BEHIND'
        : 'ON_TRACK';
  return { scheduleVariancePercent: variance, status };
}

/** YYYY-MM-DD in UTC — the period-end date is a calendar date, not a moment. */
export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}
