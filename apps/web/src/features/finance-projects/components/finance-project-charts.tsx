'use client';

import { useId } from 'react';
import { useLocale } from 'next-intl';

/**
 * The Finance project dashboard's charts — token-styled SVG under the same rules as the cost and
 * progress charts:
 *  - **Data-viz colours only** (`--chart-1..5`); a series is data, not a status.
 *  - **Responsive**: `width=100%` on a `viewBox`, so 375px never scrolls sideways.
 *  - **The numbers are in the DOM**: each chart is `role="img"` with a text summary, and the caller
 *    prints the figures beside it. Nobody has to read a value off an axis.
 */

/** A compact axis label in the reader's locale — "1.2M", "450K". Full figures sit beside the chart. */
function useCompact() {
  const locale = useLocale();
  const format = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  return (value: number) => format.format(value);
}

/** A rounded ceiling, so gridlines land on readable numbers rather than on the data's max. */
export function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

const VIEW_W = 640;
const VIEW_H = 220;
const PAD_LEFT = 48;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 30;
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

export interface InOutGroup {
  label: string;
  inflow: number;
  outflow: number;
}

/**
 * Money expected in vs out per period: two bars per period, in beside out. In and out are two
 * different things, so they take two different hues (teal / violet), not two steps of one ramp.
 */
export function InOutBars({
  groups,
  summary,
  inLabel,
  outLabel,
}: {
  groups: InOutGroup[];
  /** The chart's text alternative — say what it shows in one sentence, with the totals. */
  summary: string;
  inLabel: string;
  outLabel: string;
}) {
  const titleId = useId();
  const compact = useCompact();
  const ceiling = niceCeiling(Math.max(...groups.flatMap((g) => [g.inflow, g.outflow]), 0));
  const band = PLOT_W / Math.max(groups.length, 1);
  const bar = Math.min(22, (band - 12) / 2);
  const y = (value: number) => PAD_TOP + PLOT_H - (value / ceiling) * PLOT_H;

  return (
    <div>
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" aria-labelledby={titleId} className="block">
        <title id={titleId}>{summary}</title>
        {[0, 0.5, 1].map((tick) => (
          <g key={tick} aria-hidden="true">
            <line
              x1={PAD_LEFT}
              x2={VIEW_W - PAD_RIGHT}
              y1={y(ceiling * tick)}
              y2={y(ceiling * tick)}
              stroke="var(--color-border)"
              strokeWidth={1}
            />
            <text x={PAD_LEFT - 8} y={y(ceiling * tick) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted-foreground)">
              {compact(ceiling * tick)}
            </text>
          </g>
        ))}
        {groups.map((g, i) => {
          const centre = PAD_LEFT + i * band + band / 2;
          return (
            <g key={g.label} aria-hidden="true">
              {[
                { value: g.inflow, fill: 'var(--color-chart-5)', x: centre - bar },
                { value: g.outflow, fill: 'var(--color-chart-4)', x: centre },
              ].map((s, j) => (
                <rect
                  key={j}
                  x={s.x}
                  y={y(s.value)}
                  width={Math.max(bar - 2, 2)}
                  height={Math.max(0, PAD_TOP + PLOT_H - y(s.value))}
                  rx={2}
                  fill={s.fill}
                />
              ))}
              <text x={centre} y={VIEW_H - 10} textAnchor="middle" fontSize={11} fill="var(--color-muted-foreground)">
                {g.label}
              </text>
            </g>
          );
        })}
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1" aria-hidden="true">
        {[
          { label: inLabel, colour: 'var(--color-chart-5)' },
          { label: outLabel, colour: 'var(--color-chart-4)' },
        ].map((item) => (
          <li key={item.label} className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span className="size-2.5 rounded-xs" style={{ background: item.colour }} />
            {item.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ShareSegment {
  /** Share of the whole, 0–100. */
  percent: number;
  colour: 'chart-1' | 'chart-3' | 'track';
}

/**
 * One horizontal bar split into segments — a stage's money: collected, billed but unpaid, not yet
 * billed. Decorative (`aria-hidden`); the caller writes the same state in words beside it.
 */
export function SegmentBar({ segments, className }: { segments: ShareSegment[]; className?: string }) {
  return (
    <span aria-hidden="true" className={`flex h-2 w-full overflow-hidden rounded-full bg-muted ${className ?? ''}`}>
      {segments
        .filter((s) => s.colour !== 'track' && s.percent > 0)
        .map((s, i) => (
          <span key={i} className="h-full" style={{ width: `${Math.min(100, s.percent)}%`, background: `var(--color-${s.colour})` }} />
        ))}
    </span>
  );
}

/**
 * A figure against the largest of its group, as a bar — "Budget / Committed / Actual" read at a
 * glance. Decorative; the figure is printed in the row.
 */
export function ValueBar({ value, max, colour }: { value: number; max: number; colour: 'chart-1' | 'chart-2' | 'chart-3' | 'chart-4' }) {
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return (
    <span aria-hidden="true" className="block h-2 w-full overflow-hidden rounded-full bg-muted">
      <span className="block h-full rounded-full" style={{ width: `${percent}%`, background: `var(--color-${colour})` }} />
    </span>
  );
}
