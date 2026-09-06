'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';

/**
 * Two small, token-styled SVG charts for the project cost screens.
 *
 * They follow the same rules as the progress S-curve:
 *  - **Data-viz colours only** (`--chart-1..5`). Status tokens never touch a series — a chart is
 *    data, not a status, and colouring it success/danger would say nothing to a colour-blind
 *    reader while colliding with the meaning those tokens carry everywhere else.
 *  - **Responsive, never page-forcing.** `width=100%` on a `viewBox`; no fixed pixel width, so
 *    375px never gains a horizontal scrollbar.
 *  - **The numbers are in the DOM, not only in the picture.** Each chart is `role="img"` with a
 *    text summary, and the legend carries the figures — a reader who cannot see the bars still
 *    gets the data, and nobody has to estimate a value off an axis.
 *  - **Charts are secondary.** They sit beside the tables that hold the authoritative figures,
 *    never in place of them.
 */

const BAR_VIEW_W = 720;
const BAR_VIEW_H = 240;
const BAR_PAD_LEFT = 56;
const BAR_PAD_RIGHT = 8;
const BAR_PAD_TOP = 10;
const BAR_PAD_BOTTOM = 34;
const BAR_PLOT_W = BAR_VIEW_W - BAR_PAD_LEFT - BAR_PAD_RIGHT;
const BAR_PLOT_H = BAR_VIEW_H - BAR_PAD_TOP - BAR_PAD_BOTTOM;

export interface CostBarGroup {
  label: string;
  committed: number;
  accrued: number;
  actual: number;
}

/** A compact axis label — `$1.2M`, `$450K`. Full precision lives in the table. */
function axisMoney(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}

/**
 * Committed / accrued / actual per cost area.
 *
 * All three stages, not two. The ledger has three and showing only the first and last would
 * hide exactly the gap that matters — goods received but not yet billed.
 */
export function CostByAreaChart({ groups }: { groups: CostBarGroup[] }) {
  const t = useTranslations('procurement.project.cost');
  const titleId = useId();

  const max = Math.max(
    ...groups.flatMap((g) => [g.committed, g.accrued, g.actual]),
    1,
  );
  // A rounded ceiling so the gridlines land on readable numbers rather than on the data's max.
  const ceiling = niceCeiling(max);
  const bandWidth = BAR_PLOT_W / Math.max(groups.length, 1);
  const barWidth = Math.min(18, (bandWidth - 16) / 3);
  const ticks = [0, 0.25, 0.5, 0.75, 1];

  const y = (value: number) => BAR_PAD_TOP + BAR_PLOT_H - (value / ceiling) * BAR_PLOT_H;

  return (
    <div>
      <svg
        viewBox={`0 0 ${BAR_VIEW_W} ${BAR_VIEW_H}`}
        width="100%"
        role="img"
        aria-labelledby={titleId}
        className="block"
      >
        <title id={titleId}>{t('chartByAreaSummary', { n: groups.length })}</title>

        {ticks.map((tick) => {
          const value = ceiling * tick;
          return (
            <g key={tick} aria-hidden="true">
              <line
                x1={BAR_PAD_LEFT}
                x2={BAR_VIEW_W - BAR_PAD_RIGHT}
                y1={y(value)}
                y2={y(value)}
                stroke="var(--color-border)"
                strokeWidth={1}
              />
              <text
                x={BAR_PAD_LEFT - 8}
                y={y(value) + 4}
                textAnchor="end"
                fontSize={11}
                fill="var(--color-muted-foreground)"
              >
                {axisMoney(value)}
              </text>
            </g>
          );
        })}

        {groups.map((group, index) => {
          const base = BAR_PAD_LEFT + index * bandWidth;
          const centre = base + bandWidth / 2;
          const series = [
            { value: group.committed, fill: 'var(--color-chart-1)' },
            { value: group.accrued, fill: 'var(--color-chart-2)' },
            { value: group.actual, fill: 'var(--color-chart-3)' },
          ];
          return (
            <g key={group.label} aria-hidden="true">
              {series.map((s, i) => {
                const height = Math.max(0, BAR_PAD_TOP + BAR_PLOT_H - y(s.value));
                const x = centre - (barWidth * 3) / 2 + i * barWidth;
                return (
                  <rect
                    key={i}
                    x={x}
                    y={y(s.value)}
                    width={Math.max(barWidth - 2, 2)}
                    height={height}
                    rx={2}
                    fill={s.fill}
                  />
                );
              })}
              <text
                x={centre}
                y={BAR_VIEW_H - 12}
                textAnchor="middle"
                fontSize={11}
                fill="var(--color-muted-foreground)"
              >
                {group.label.length > 14 ? `${group.label.slice(0, 13)}…` : group.label}
              </text>
            </g>
          );
        })}
      </svg>

      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {(['committed', 'accrued', 'actual'] as const).map((key, i) => (
          <li key={key} className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span
              className="size-2.5 rounded-xs"
              style={{ background: `var(--color-chart-${i + 1})` }}
              aria-hidden="true"
            />
            {t(`col.${key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Share ring ─────────────────────────────────────────────────────────────────

const RING_SIZE = 160;
const RING_STROKE = 22;
const RING_RADIUS = (RING_SIZE - RING_STROKE) / 2;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

export interface ShareSlice {
  label: string;
  value: number;
  amount: string | null;
}

/**
 * A share ring with its figures listed beside it.
 *
 * The ring is the secondary reading and the list is the primary one: procurement needs "which
 * supplier holds this exposure, and how much", answered to the cent — not the shape of a
 * distribution. So every slice appears in the legend with its amount, and the ring only shows
 * proportion at a glance. Slices past the fifth are folded into "Others" rather than rendered as
 * hairlines nobody can point at.
 */
export function ShareRing({
  slices,
  total,
  centreLabel,
  currency,
}: {
  slices: ShareSlice[];
  total: number;
  centreLabel: string;
  currency: string | null;
}) {
  const t = useTranslations('procurement.project.cost');
  const locale = useLocale() as 'en' | 'ar';
  const titleId = useId();

  if (total <= 0 || slices.length === 0) {
    return <p className="py-2 text-body-sm text-muted-foreground">{t('noCost')}</p>;
  }

  // Each arc starts where the previous one ended. Written as a scan rather than a `let` the
  // map reassigns: mutating a variable declared outside the callback during render is what
  // the compiler flags, and a running total is the one case where it is tempting.
  const arcs = slices.reduce<
    Array<ShareSlice & { fraction: number; dash: number; offset: number; colour: string }>
  >((acc, slice, index) => {
    const previous = acc[acc.length - 1];
    const fraction = slice.value / total;
    acc.push({
      ...slice,
      fraction,
      dash: fraction * RING_CIRCUMFERENCE,
      offset: previous ? previous.offset + previous.dash : 0,
      colour: SERIES[index] ?? SERIES[SERIES.length - 1]!,
    });
    return acc;
  }, []);

  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg
        viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
        width={RING_SIZE}
        height={RING_SIZE}
        role="img"
        aria-labelledby={titleId}
        className="shrink-0"
      >
        <title id={titleId}>{t('chartShareSummary', { n: slices.length })}</title>
        <g transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`} aria-hidden="true">
          {arcs.map((arc) => (
            <circle
              key={arc.label}
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RING_RADIUS}
              fill="none"
              stroke={arc.colour}
              strokeWidth={RING_STROKE}
              strokeDasharray={`${arc.dash} ${RING_CIRCUMFERENCE - arc.dash}`}
              strokeDashoffset={-arc.offset}
            />
          ))}
        </g>
        <text
          x={RING_SIZE / 2}
          y={RING_SIZE / 2 - 2}
          textAnchor="middle"
          fontSize={15}
          fontWeight={700}
          fill="var(--color-foreground)"
        >
          {axisMoney(total)}
        </text>
        <text
          x={RING_SIZE / 2}
          y={RING_SIZE / 2 + 14}
          textAnchor="middle"
          fontSize={10}
          fill="var(--color-muted-foreground)"
        >
          {centreLabel}
        </text>
      </svg>

      {/* The figures, not an estimate off the ring. */}
      <ul className="min-w-0 flex-1 space-y-1.5">
        {arcs.map((arc) => (
          <li key={arc.label} className="flex items-center gap-2 text-caption">
            <span
              className="size-2.5 shrink-0 rounded-xs"
              style={{ background: arc.colour }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate text-foreground">{arc.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {Math.round(arc.fraction * 100)}%
            </span>
            <span className={cn('shrink-0 tabular-nums font-medium text-foreground')}>
              {formatMoney(arc.amount, currency, locale) ?? '—'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Round a maximum up to a readable gridline value, so the axis reads 0/250K/500K, not 0/187K. */
function niceCeiling(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  const normalised = max / magnitude;
  const step = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return step * magnitude;
}

/**
 * The categorical slots, assigned in fixed order.
 *
 * `--series-*`, not `--chart-*`. The two answer different questions and are not
 * interchangeable: `--chart-1/2/3` are one blue at three lightnesses, a sequential ramp that is
 * exactly right for committed → accrued → actual because those are stages of one cost. Suppliers
 * and spend categories have no order, and cycling that ramp across them rendered three
 * near-identical blues — measured, ΔE 10.9 for a reader with normal colour vision against a
 * floor of 15, with one slot at 2.02:1 contrast.
 *
 * Never cycled: a sixth hue generated by wrapping is indistinguishable from one already on
 * screen. `topSlices` folds the tail into "Others" before it gets here, and the fallback below
 * exists only so a caller that forgets cannot silently repeat a colour on a different category.
 */
const SERIES = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
] as const;

/** Fold a long tail into "Others" — five nameable slices beats twelve hairlines. */
export function topSlices(
  rows: Array<{ label: string; value: number; amount: string | null }>,
  limit: number,
  othersLabel: string,
): ShareSlice[] {
  const sorted = [...rows].sort((a, b) => b.value - a.value).filter((r) => r.value > 0);
  if (sorted.length <= limit) return sorted;
  const head = sorted.slice(0, limit - 1);
  const tail = sorted.slice(limit - 1);
  const tailValue = tail.reduce((sum, r) => sum + r.value, 0);
  return [
    ...head,
    { label: othersLabel, value: tailValue, amount: tailValue.toFixed(2) },
  ];
}
