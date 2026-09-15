'use client';

import { useId } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { CommercialInvoiceRow, CommercialReceiptRow } from '@erp/types';

import { formatDate, formatMoney } from '@/lib/format';

/**
 * The cashflow curve — cumulative invoiced vs cumulative collected over time.
 *
 * The hero visual of the Billing tab (spec S-BL-2 / ADR-030 CD14). It answers the one question a
 * money story of four static figures cannot: *is the gap between what we billed and what we banked
 * widening or closing?* Two rising lines on a shared date axis show it at a glance.
 *
 * Modelled on `progress/components/progress-curve-chart.tsx` so Commercial and Progress read as one
 * system, and it follows the same rules (ux-doctrine §7, §8, and the cost-charts sibling):
 *  - **Data-viz colours only.** Invoiced is `--chart-1`, collected is `--chart-2`. Neither is a
 *    status token — a chart is data, not an alarm, and colouring the gap red would say nothing to a
 *    colour-blind reader while colliding with the meaning `danger` carries elsewhere.
 *  - **Responsive, never page-forcing.** `width=100%` on a `viewBox`; no fixed pixel width, so
 *    375px never gains a horizontal scrollbar.
 *  - **Honest about thin data.** Zero invoices ⇒ the caller shows the empty-state and this renders
 *    nothing. A single event on a series ⇒ a dot, never a line that implies a trend never measured.
 *  - **No client re-summing beyond a running total.** The only arithmetic here is the cumulative sum
 *    of the server's own per-document `amount` strings — the money rule (what an invoice/receipt is
 *    worth) stays the server's. The axis maximum is the last cumulative point, not a re-derived total.
 *  - **Screen readers get the numbers, not the path.** `role="img"` with a text summary of the final
 *    cumulative invoiced/collected; the paths are `aria-hidden`.
 */

// An abstract-unit viewBox that scales to the container. Money maps to Y; the shared date axis to X.
const VIEW_W = 720;
const VIEW_H = 240;
const PAD_LEFT = 56; // room for the Y-axis money labels ($1.2M etc.)
const PAD_RIGHT = 12;
const PAD_TOP = 12;
const PAD_BOTTOM = 28; // room for the X-axis date labels
const PLOT_W = VIEW_W - PAD_LEFT - PAD_RIGHT;
const PLOT_H = VIEW_H - PAD_TOP - PAD_BOTTOM;

const Y_TICKS = [0, 0.25, 0.5, 0.75, 1] as const;

/** One cumulative point: a calendar date and the running total to date, as a number for plotting. */
interface CumulativePoint {
  date: string;
  cumulative: number;
}

/** A document with a date and a money-string amount — an invoice or a receipt row. */
interface DatedAmount {
  date: string;
  amount: string | null;
}

/**
 * Build the cumulative series: sort the events by date, then carry a running total.
 *
 * The running sum is the ONLY arithmetic the frontend does on money, and it is on the server's own
 * `amount` strings (parsed at the render boundary, never re-derived). A document with a null amount
 * (no financial visibility, or an unposted draft) contributes 0 to the running total rather than
 * breaking the series — but this component is only mounted when financials are visible, so in
 * practice every amount is present. Exported for the test to assert the cumulative totals directly.
 */
export function toCumulativeSeries(events: DatedAmount[]): CumulativePoint[] {
  const sorted = [...events].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  return sorted.map((event) => {
    const value = event.amount === null ? 0 : Number(event.amount);
    running += Number.isFinite(value) ? value : 0;
    return { date: event.date, cumulative: running };
  });
}

/** Map a value on 0..max to a Y pixel (inverted — the maximum is at the top). */
function yPos(value: number, max: number): number {
  if (max <= 0) return PAD_TOP + PLOT_H;
  const clamped = Math.max(0, Math.min(max, value));
  return PAD_TOP + PLOT_H * (1 - clamped / max);
}

/** Map a date's position on the shared axis to an X pixel. One date ⇒ centred. */
function xPos(date: string, dates: string[]): number {
  const index = dates.indexOf(date);
  if (dates.length <= 1) return PAD_LEFT + PLOT_W / 2;
  return PAD_LEFT + (PLOT_W * index) / (dates.length - 1);
}

function toPath(series: CumulativePoint[], dates: string[], max: number): string {
  return series
    .map((point) => `${xPos(point.date, dates)},${yPos(point.cumulative, max)}`)
    .map((coord, i) => `${i === 0 ? 'M' : 'L'}${coord}`)
    .join(' ');
}

/**
 * A compact axis label — `1.2M`, `450K`. The currency is stated once, in the panel title and the
 * money story above; repeating a symbol on every gridline is noise. Full precision lives in the
 * money story and the invoice/receipt tables.
 */
function axisMoney(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return `${Math.round(value)}`;
}

export function CashflowChart({
  invoices,
  receipts,
  currency,
}: {
  invoices: CommercialInvoiceRow[];
  receipts: CommercialReceiptRow[];
  currency: string | null;
}) {
  const t = useTranslations('commercial.billing.cashflow');
  const locale = useLocale() as 'en' | 'ar';
  const titleId = useId();

  const invoicedSeries = toCumulativeSeries(
    invoices.map((invoice) => ({ date: invoice.invoiceDate, amount: invoice.totalAmount })),
  );
  const collectedSeries = toCumulativeSeries(
    receipts.map((receipt) => ({
      date: receipt.receiptDate,
      // Only the share that landed against THIS contract's invoices belongs on this contract's
      // collection curve — a client-level receipt that partly settled another contract must not
      // inflate the line. The server computes that split; the frontend never re-derives it.
      amount: receipt.allocatedToThisContract,
    })),
  );

  // No invoices ⇒ nothing to plot. Collection cannot exist without invoicing, so the invoiced
  // series being empty is the honest empty-state; the caller renders it, this draws nothing.
  if (invoicedSeries.length === 0) return null;

  // The shared X axis is the union of every date across both series, in order. A same-date invoice
  // and receipt land on the same X, which is what makes the two lines comparable.
  const dates = Array.from(
    new Set([...invoicedSeries.map((p) => p.date), ...collectedSeries.map((p) => p.date)]),
  ).sort((a, b) => a.localeCompare(b));

  // The axis ceiling is the highest cumulative point — always the last invoiced point, since
  // collected can never exceed invoiced on a settled basis, but max both to stay honest if a
  // receipt is dated before its invoice in the data.
  const lastInvoiced = invoicedSeries.at(-1)?.cumulative ?? 0;
  const lastCollected = collectedSeries.at(-1)?.cumulative ?? 0;
  const max = Math.max(lastInvoiced, lastCollected, 1);

  const ariaSummary = t('ariaSummary', {
    invoiced: formatMoney(String(lastInvoiced), currency, locale) ?? '—',
    collected: formatMoney(String(lastCollected), currency, locale) ?? '—',
    points: invoicedSeries.length,
  });

  // Only label a subset of X ticks when there are many, so labels never collide at 375px.
  const labelEvery = Math.max(1, Math.ceil(dates.length / 4));

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

        {/* Gridlines + Y-axis money labels. Hairline muted, never a status colour. */}
        <g aria-hidden="true">
          {Y_TICKS.map((tick) => {
            const value = max * tick;
            const y = yPos(value, max);
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
                  {axisMoney(value)}
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
                x={xPos(date, dates)}
                y={VIEW_H - 8}
                textAnchor="middle"
                className="fill-muted-foreground text-micro tabular-nums tracking-normal"
              >
                {formatDate(date, locale) ?? '—'}
              </text>
            );
          })}
        </g>

        {/* Invoiced — the primary cumulative series, chart-1. One point ⇒ a dot, never a line. */}
        {invoicedSeries.length >= 2 ? (
          <path
            d={toPath(invoicedSeries, dates, max)}
            fill="none"
            className="stroke-chart-1"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        ) : null}
        {invoicedSeries.map((point) => (
          <circle
            key={`i-${point.date}`}
            cx={xPos(point.date, dates)}
            cy={yPos(point.cumulative, max)}
            r={3}
            className="fill-chart-1"
            aria-hidden="true"
          />
        ))}

        {/* Collected — chart-2. Same one-point-⇒-dot rule. */}
        {collectedSeries.length >= 2 ? (
          <path
            d={toPath(collectedSeries, dates, max)}
            fill="none"
            className="stroke-chart-2"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            aria-hidden="true"
          />
        ) : null}
        {collectedSeries.map((point) => (
          <circle
            key={`c-${point.date}`}
            cx={xPos(point.date, dates)}
            cy={yPos(point.cumulative, max)}
            r={3}
            className="fill-chart-2"
            aria-hidden="true"
          />
        ))}
      </svg>

      {/* Legend — colour + word, never colour alone. */}
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-chart-1" aria-hidden="true" />
          {t('invoiced')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded-full bg-chart-2" aria-hidden="true" />
          {t('collected')}
        </span>
      </figcaption>
    </figure>
  );
}
