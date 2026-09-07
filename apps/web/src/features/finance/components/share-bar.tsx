'use client';

import * as React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { formatMoney } from '@/lib/format';

/**
 * Part-to-whole, drawn as a horizontal stacked bar.
 *
 * **Not a donut**, deliberately. A stacked bar is the default form for part-to-whole, and
 * horizontal is the variant for long category names — "Project-level (non-BOQ)" and
 * "Superstructure" do not fit around a ring, and a donut forces the reader to compare arc
 * lengths, which people are measurably bad at. The reference design used donuts; this reads the
 * same information more accurately in less vertical space.
 *
 * **The legend carries the numbers.** Three of the five categorical hues sit below 3:1 against
 * the light surface, so identity can never rest on colour alone: every segment is named and
 * valued in the legend beneath, and the precise table is on the same screen. That is the relief
 * the palette's contrast warning requires, and it is also just how a finance figure should be
 * read — the bar is for proportion, the number is the fact.
 *
 * Colour comes from `--series-*`, the validated categorical set, never from `--chart-*`, which
 * is a sequential ramp for the committed → accrued → actual progression.
 */

/** The five categorical slots, assigned in fixed order and never cycled past the fifth. */
const SERIES = [
  'var(--color-series-1)',
  'var(--color-series-2)',
  'var(--color-series-3)',
  'var(--color-series-4)',
  'var(--color-series-5)',
] as const;

export interface ShareDatum {
  key: string;
  label: string;
  /** Decimal string, as every money value in this workspace is. */
  amount: string;
}

export interface ShareSegment extends ShareDatum {
  percent: number;
  fill: string;
}

/**
 * The top slices plus an "Other" fold.
 *
 * A sixth generated hue is indistinguishable from one already on screen, so the tail folds
 * rather than growing the palette. Zero and negative amounts are dropped: a stacked bar shows
 * how a positive whole divides, and a negative slice has no length.
 */
export function toSegments(data: ShareDatum[], otherLabel: string): ShareSegment[] {
  const positive = data
    .map((d) => ({ ...d, value: Number(d.amount) }))
    .filter((d) => Number.isFinite(d.value) && d.value > 0)
    .sort((a, b) => b.value - a.value);

  const total = positive.reduce((sum, d) => sum + d.value, 0);
  if (total <= 0) return [];

  const head = positive.slice(0, SERIES.length - 1);
  const tail = positive.slice(SERIES.length - 1);

  const segments: ShareSegment[] = head.map((d, i) => ({
    key: d.key,
    label: d.label,
    amount: d.amount,
    percent: Math.round((d.value / total) * 1000) / 10,
    fill: SERIES[i]!,
  }));

  if (tail.length > 0) {
    const rest = tail.reduce((sum, d) => sum + d.value, 0);
    segments.push({
      key: '__other',
      label: otherLabel,
      amount: rest.toFixed(2),
      percent: Math.round((rest / total) * 1000) / 10,
      fill: SERIES[SERIES.length - 1]!,
    });
  }

  return segments;
}

export function ShareBar({
  title,
  segments,
  total,
  currency,
  totalLabel,
}: {
  title: string;
  segments: ShareSegment[];
  /** The whole the segments divide. Shown as the figure the bar is a picture of. */
  total: string | null;
  currency: string | null;
  totalLabel: string;
}) {
  const t = useTranslations('finance.common');
  const locale = useLocale() as 'en' | 'ar';
  const money = (amount: string) =>
    currency ? (formatMoney(amount, currency, locale) ?? amount) : amount;

  if (segments.length === 0) {
    return (
      <div className="px-4 py-5 sm:px-5">
        <p className="text-body-sm text-muted-foreground">{t('noChartData')}</p>
      </div>
    );
  }

  return (
    <figure className="m-0 px-4 py-4 sm:px-5">
      <figcaption className="sr-only">{title}</figcaption>

      <div className="flex items-baseline justify-between gap-3">
        <span className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {totalLabel}
        </span>
        <span className="text-h3 font-bold tabular-nums text-foreground">
          {total === null ? t('unavailable') : money(total)}
        </span>
      </div>

      {/* A 2px surface gap between fills, so adjacent segments read as separate marks even
          when two hues are close for a colour-blind reader. */}
      <div
        className="mt-2.5 flex h-3 w-full gap-0.5 overflow-hidden rounded-full"
        role="img"
        aria-label={`${title}. ${segments
          .map((s) => `${s.label} ${s.percent}%`)
          .join(', ')}`}
      >
        {segments.map((segment, i) => (
          <span
            key={segment.key}
            title={`${segment.label} — ${money(segment.amount)} (${segment.percent}%)`}
            className={cn(
              'h-full min-w-1',
              i === 0 && 'rounded-s-full',
              i === segments.length - 1 && 'rounded-e-full',
            )}
            style={{ width: `${segment.percent}%`, background: segment.fill }}
          />
        ))}
      </div>

      {/* Identity never rests on colour: every segment is named and valued here. */}
      <ul className="mt-3 space-y-1.5">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-baseline gap-2">
            <span
              aria-hidden="true"
              className="mt-1 size-2 shrink-0 rounded-full"
              style={{ background: segment.fill }}
            />
            <span className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
              {segment.label}
            </span>
            <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
              {segment.percent}%
            </span>
            <span className="shrink-0 text-caption font-medium tabular-nums text-foreground">
              {money(segment.amount)}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}

/**
 * A single ratio against a limit, drawn as a meter.
 *
 * The form for "how much of the whole has this consumed" — not a two-slice pie, and not two
 * separate bars, which make a reader compare two lengths that share no baseline.
 *
 * **The ratio is named as a division, not as a verb.** "Revenue consumed" invites a finance
 * reader to hear cash collection or revenue-recognition mechanics; `Project cost / Revenue`
 * says exactly which number is over which, and the three figures beneath it — revenue, cost, and
 * the remainder — let the reader check the arithmetic rather than trust the bar. The remainder is
 * named by the caller, because what is left over depends on what the fill included: subtracting
 * *all* project cost leaves net income, not gross profit.
 *
 * Two states have no ratio and must not be forced into one:
 *
 *  - **Limit is zero, fill is not.** The division is undefined. Rendering 100% would claim the
 *    project consumed all of its revenue; rendering ∞% is not a number anyone can act on. The
 *    meter is replaced by the two figures and a plain statement that there is no revenue posted.
 *  - **Both are zero.** Nothing has happened yet — an empty state, not a chart of zero.
 */
export function Meter({
  ratioLabel,
  limitLabel,
  limit,
  fillLabel,
  fill,
  remainderLabel,
  remainderNegativeLabel,
  noLimitLabel,
  emptyLabel,
  currency,
}: {
  /** The division itself, e.g. "Project cost / Revenue". Never a verb. */
  ratioLabel: string;
  limitLabel: string;
  limit: string;
  fillLabel: string;
  fill: string;
  remainderLabel: string;
  /** Used when the fill exceeds the limit — "Net loss" rather than a negative remainder. */
  remainderNegativeLabel: string;
  /** Used when the limit is zero: the ratio is undefined, so it is not shown at all. */
  noLimitLabel: string;
  /** Used when nothing has happened yet. */
  emptyLabel: string;
  currency: string | null;
}) {
  const locale = useLocale() as 'en' | 'ar';
  const money = (amount: string) =>
    currency ? (formatMoney(amount, currency, locale) ?? amount) : amount;

  const limitValue = Number(limit);
  const fillValue = Number(fill);
  const remainder = limitValue - fillValue;
  const over = remainder < 0;
  const hasLimit = limitValue > 0;
  const percent = hasLimit ? Math.round((fillValue / limitValue) * 1000) / 10 : null;

  // Nothing posted at all. A meter at 0% claims a measurement that was never taken.
  if (!hasLimit && fillValue <= 0) {
    return (
      <div className="px-4 py-5 sm:px-5">
        <p className="text-body-sm text-muted-foreground">{emptyLabel}</p>
      </div>
    );
  }

  // Cost with no revenue behind it. `cost / 0` is undefined — not 100%, and not infinity — so
  // the figures are reported and the ratio is not.
  if (!hasLimit) {
    return (
      <figure className="m-0 px-4 py-4 sm:px-5">
        <figcaption className="sr-only">{ratioLabel}</figcaption>
        <p className="text-body-sm font-medium text-foreground">{noLimitLabel}</p>
        <dl className="mt-3 space-y-1.5">
          <div className="flex items-baseline gap-2">
            <dt className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
              {fillLabel}
            </dt>
            <dd className="shrink-0 text-caption font-medium tabular-nums text-foreground">
              {money(fill)}
            </dd>
          </div>
        </dl>
      </figure>
    );
  }

  return (
    <figure className="m-0 px-4 py-4 sm:px-5">
      <figcaption className="sr-only">{ratioLabel}</figcaption>

      {/* The ratio names its own division, so there is nothing to infer about which number is
          over which — and the three figures beneath let the reader check it. */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {ratioLabel}
        </span>
        <span
          className={cn(
            'text-h3 font-bold tabular-nums',
            over ? 'text-danger' : 'text-foreground',
          )}
        >
          {percent}%
        </span>
      </div>

      <div
        className="mt-2.5 h-3 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={percent ?? 0}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={ratioLabel}
      >
        <span
          className={cn('block h-full rounded-full', over ? 'bg-danger' : 'bg-brand-primary')}
          style={{
            width: `${percent === null ? 0 : Math.max(0, Math.min(100, percent))}%`,
          }}
        />
      </div>

      <dl className="mt-3 space-y-1.5">
        <div className="flex items-baseline gap-2">
          <dt className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {limitLabel}
          </dt>
          <dd className="shrink-0 text-caption font-medium tabular-nums text-foreground">
            {money(limit)}
          </dd>
        </div>
        <div className="flex items-baseline gap-2">
          <dt className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {fillLabel}
          </dt>
          <dd className="shrink-0 text-caption font-medium tabular-nums text-foreground">
            {money(fill)}
          </dd>
        </div>
        <div className="flex items-baseline gap-2 border-t border-border pt-1.5">
          <dt className="min-w-0 flex-1 truncate text-caption text-muted-foreground">
            {over ? remainderNegativeLabel : remainderLabel}
          </dt>
          <dd
            className={cn(
              'shrink-0 text-caption font-semibold tabular-nums',
              over ? 'text-danger' : 'text-foreground',
            )}
          >
            {money(Math.abs(remainder).toFixed(2))}
          </dd>
        </div>
      </dl>
    </figure>
  );
}
