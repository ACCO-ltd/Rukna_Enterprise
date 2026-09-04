'use client';

import { useId } from 'react';
import { useTranslations } from 'next-intl';
import type { ProgressActualPoint, ProgressCurvePoint } from '@erp/types';

import { formatDate } from '@/lib/format';

/**
 * Planned-vs-actual progress S-curve — a small, token-styled SVG line chart.
 *
 * Design rules it follows (ux-doctrine §7, §8 and the FE-1 brief):
 *  - **Data-viz colours only.** The actual physical line is `--chart-1`; the optional verified
 *    line is `--chart-2`; the planned baseline is a *dashed muted hairline* (`muted-foreground`),
 *    not a third hue. None of the status tokens (success/warning/danger) touch a series — a chart
 *    is data, not a status, and colouring it by status would say nothing to a colour-blind reader.
 *  - **Responsive, never page-forcing.** The SVG is `width=100%` on a `viewBox`; it scales to its
 *    container and never introduces horizontal page scroll at 375px. No fixed pixel width.
 *  - **Honest about thin data.** With a single actual point it draws the point, not a line that
 *    would imply a trend that was never measured. With zero points it renders nothing and lets the
 *    caller show the insufficient-data state instead.
 *  - **Screen-reader gets the numbers, not the path.** The `<svg>` is `img` with a text summary of
 *    the latest planned/actual figures; the visual paths are `aria-hidden`.
 *
 * App-level for now; a candidate to promote to `@erp/ui` as a generic `LineChart` if a second
 * screen needs one.
 */

// A 0–100 chart in an unspaced viewBox. Units are abstract; the SVG scales to the container.
const VIEW_W = 720;
const VIEW_H = 240;
const PAD_LEFT = 40; // room for the Y-axis % labels
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28; // room for the X-axis date labels
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

const Y_TICKS = [0, 25, 50, 75, 100] as const;

interface Series {
  periodEndDate: string;
  value: number;
}

export interface ProgressCurveChartProps {
  baseline: ProgressCurvePoint[];
  actual: ProgressActualPoint[];
  /** Draw the faint verified line as well as physical. Off by default to keep the chart calm. */
  showVerified?: boolean;
  /**
   * The planned line is the provisional Option-C estimate (no approved baseline yet). Renders it
   * fainter and labels the legend "estimate" so a reader never mistakes it for a committed plan.
   */
  plannedProvisional?: boolean;
}

/** Map a value on 0..100 to a Y pixel (inverted — 100% is at the top). */
function yPos(value: number): number {
  const clamped = Math.max(0, Math.min(100, value));
  return PAD_TOP + PLOT_H * (1 - clamped / 100);
}

/** Map a point's index across the shared date axis to an X pixel. */
function xPos(index: number, count: number): number {
  if (count <= 1) return PAD_LEFT + PLOT_W / 2;
  return PAD_LEFT + (PLOT_W * index) / (count - 1);
}

function toPath(series: Series[], dates: string[]): string {
  return series
    .map((point) => {
      const index = dates.indexOf(point.periodEndDate);
      return `${xPos(index, dates.length)},${yPos(point.value)}`;
    })
    .map((coord, i) => `${i === 0 ? 'M' : 'L'}${coord}`)
    .join(' ');
}

export function ProgressCurveChart({
  baseline,
  actual,
  showVerified = false,
  plannedProvisional = false,
}: ProgressCurveChartProps) {
  const t = useTranslations('progress');
  const titleId = useId();
  const plannedLabel = plannedProvisional ? t('curve.plannedEstimate') : t('curve.plannedBaseline');

  // The shared X axis is the union of every date across both series, in order. A planned point
  // and an actual point on the same date land on the same X, which is what makes them comparable.
  const dates = Array.from(
    new Set([...baseline.map((b) => b.periodEndDate), ...actual.map((a) => a.periodEndDate)]),
  ).sort();

  // Zero actual points: nothing to draw. The caller shows the insufficient-data state.
  if (actual.length === 0 && baseline.length === 0) return null;

  const plannedSeries: Series[] = baseline.map((b) => ({
    periodEndDate: b.periodEndDate,
    value: b.plannedPercent,
  }));
  const physicalSeries: Series[] = actual.map((a) => ({
    periodEndDate: a.periodEndDate,
    value: a.physicalPercent,
  }));
  const verifiedSeries: Series[] = actual.map((a) => ({
    periodEndDate: a.periodEndDate,
    value: a.verifiedPercent,
  }));

  const latestActual = actual.at(-1) ?? null;
  const latestPlanned = baseline.at(-1) ?? null;

  // A screen reader gets the numbers that matter, not the SVG path geometry.
  const ariaSummary = t('curve.ariaSummary', {
    planned: latestPlanned ? `${latestPlanned.plannedPercent}%` : '—',
    physical: latestActual ? `${latestActual.physicalPercent}%` : '—',
    points: actual.length,
  });

  // Only label a subset of X ticks when there are many, so labels never collide at 375px.
  const labelEvery = Math.ceil(dates.length / 4);

  return (
    <figure className="space-y-2">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="h-auto w-full"
        role="img"
        aria-labelledby={titleId}
        preserveAspectRatio="none"
      >
        <title id={titleId}>{ariaSummary}</title>

        {/* Gridlines + Y-axis % labels. Hairline muted, never a status colour. */}
        <g aria-hidden="true">
          {Y_TICKS.map((tick) => {
            const y = yPos(tick);
            return (
              <g key={tick}>
                <line
                  x1={PAD_LEFT}
                  y1={y}
                  x2={VIEW_W - PAD_RIGHT}
                  y2={y}
                  className="stroke-border"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                <text
                  x={PAD_LEFT - 6}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-micro tabular-nums tracking-normal"
                >
                  {tick}
                </text>
              </g>
            );
          })}

          {/* X-axis date labels. */}
          {dates.map((date, index) => {
            if (index % labelEvery !== 0 && index !== dates.length - 1) return null;
            return (
              <text
                key={date}
                x={xPos(index, dates.length)}
                y={VIEW_H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-micro tabular-nums tracking-normal"
              >
                {formatDate(date) ?? '—'}
              </text>
            );
          })}
        </g>

        {/* Planned baseline — dashed muted reference line (a backdrop, not a series hue). */}
        {plannedSeries.length >= 2 ? (
          <path
            d={toPath(plannedSeries, dates)}
            fill="none"
            className="stroke-muted-foreground"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            strokeOpacity={plannedProvisional ? 0.55 : 1}
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        ) : null}

        {/* Verified (optional, faint) — chart-2. */}
        {showVerified && verifiedSeries.length >= 2 ? (
          <path
            d={toPath(verifiedSeries, dates)}
            fill="none"
            className="stroke-chart-2"
            strokeWidth={1.5}
            strokeOpacity={0.7}
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        ) : null}

        {/* Actual physical — the primary series, chart-1. One point ⇒ a dot, never a line. */}
        {physicalSeries.length >= 2 ? (
          <path
            d={toPath(physicalSeries, dates)}
            fill="none"
            className="stroke-chart-1"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        ) : null}
        {physicalSeries.map((point) => {
          const index = dates.indexOf(point.periodEndDate);
          return (
            <circle
              key={`p-${point.periodEndDate}`}
              cx={xPos(index, dates.length)}
              cy={yPos(point.value)}
              r={3}
              className="fill-chart-1"
              aria-hidden="true"
            />
          );
        })}
      </svg>

      {/* Legend — small, legible, tabular. Colour + word, never colour alone. */}
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span
            className="inline-block h-0.5 w-4 border-t-2 border-dashed border-muted-foreground"
            aria-hidden="true"
          />
          {plannedLabel}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-chart-1" aria-hidden="true" />
          {t('curve.actual')}
        </span>
        {showVerified ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-4 rounded-full bg-chart-2" aria-hidden="true" />
            {t('curve.verified')}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
