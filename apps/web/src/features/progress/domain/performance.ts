import type { ProgressActualPoint, ProgressCurvePoint } from '@erp/types';

/**
 * Pure figures behind Progress › Performance. Nothing here invents data: each function returns
 * `null` when the inputs cannot support a number, and the view shows "—" for it.
 */

function toTime(isoDate: string): number {
  return new Date(`${isoDate.slice(0, 10)}T00:00:00Z`).getTime();
}

/**
 * The planned cumulative % on `date`, read off the baseline curve: linear between the two points
 * either side, 0 before the first point is due, the last point's value after it. `null` without a
 * curve.
 */
export function plannedPercentAt(points: ProgressCurvePoint[], date: string): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.periodEndDate.localeCompare(b.periodEndDate));
  const at = toTime(date);
  const first = sorted[0]!;
  const last = sorted[sorted.length - 1]!;
  if (at <= toTime(first.periodEndDate)) {
    // Before the first point the plan has not reached it yet; ramp from 0 would be a guess.
    return at === toTime(first.periodEndDate) ? first.plannedPercent : 0;
  }
  if (at >= toTime(last.periodEndDate)) return last.plannedPercent;
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const next = sorted[i]!;
    const t0 = toTime(prev.periodEndDate);
    const t1 = toTime(next.periodEndDate);
    if (at <= t1) {
      const f = t1 === t0 ? 1 : (at - t0) / (t1 - t0);
      return round1(prev.plannedPercent + f * (next.plannedPercent - prev.plannedPercent));
    }
  }
  return last.plannedPercent;
}

/**
 * A work package's planned % on `date`, assuming even progress between its planned start and end
 * (the only per-package plan that exists). `null` without both dates.
 */
export function packagePlannedPercent(
  plannedStart: string | null,
  plannedEnd: string | null,
  date: string,
): number | null {
  if (!plannedStart || !plannedEnd) return null;
  const start = toTime(plannedStart);
  const end = toTime(plannedEnd);
  const at = toTime(date);
  if (end <= start) return at >= end ? 100 : 0;
  if (at <= start) return 0;
  if (at >= end) return 100;
  return Math.round(((at - start) / (end - start)) * 100);
}

/** Percentage points a package adds to the project: its weight (0..1) × its % done. */
export function contributionPoints(weight: string | number, percentComplete: number | null): number | null {
  if (percentComplete === null) return null;
  const w = Number(weight);
  if (!Number.isFinite(w)) return null;
  return round1(w * percentComplete);
}

export type PlanPosition = 'behind' | 'on' | 'ahead';

/** Where actual sits against plan. Within half a point either way reads as "on plan". */
export function planPosition(variancePoints: number): PlanPosition {
  if (variancePoints < -0.5) return 'behind';
  if (variancePoints > 0.5) return 'ahead';
  return 'on';
}

/** CSV of the curve: one row per date, planned and verified %, blank where a series has no point. */
export function curveCsv(
  planned: ProgressCurvePoint[],
  actual: ProgressActualPoint[],
  headers: { date: string; planned: string; verified: string },
): string {
  const dates = Array.from(new Set([...planned.map((p) => p.periodEndDate), ...actual.map((a) => a.periodEndDate)])).sort();
  const plannedBy = new Map(planned.map((p) => [p.periodEndDate, p.plannedPercent]));
  const verifiedBy = new Map(actual.map((a) => [a.periodEndDate, a.verifiedPercent]));
  const escape = (value: string) => (/[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  const lines = [[headers.date, headers.planned, headers.verified].map(escape).join(',')];
  for (const date of dates) {
    lines.push([date, plannedBy.get(date)?.toString() ?? '', verifiedBy.get(date)?.toString() ?? ''].join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
