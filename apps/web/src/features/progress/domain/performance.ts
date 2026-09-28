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
 * either side, the last point's value after it. `null` without a curve, and `null` before the first
 * point — the plan has not started, which is not the same as "0% planned". Points need not be
 * sorted; two points on the same date collapse to the later one given.
 */
export function plannedPercentAt(points: ProgressCurvePoint[], date: string): number | null {
  if (points.length === 0) return null;
  const byDate = new Map<string, number>();
  for (const p of points) byDate.set(p.periodEndDate.slice(0, 10), p.plannedPercent);
  const sorted = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));
  const at = toTime(date);
  const [firstDate, firstValue] = sorted[0]!;
  const [lastDate, lastValue] = sorted[sorted.length - 1]!;
  if (at < toTime(firstDate)) return null;
  if (at >= toTime(lastDate)) return lastValue;
  if (at === toTime(firstDate)) return firstValue;
  for (let i = 1; i < sorted.length; i += 1) {
    const [d0, v0] = sorted[i - 1]!;
    const [d1, v1] = sorted[i]!;
    const t0 = toTime(d0);
    const t1 = toTime(d1);
    if (at <= t1) return round1(v0 + ((at - t0) / (t1 - t0)) * (v1 - v0));
  }
  return lastValue;
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
