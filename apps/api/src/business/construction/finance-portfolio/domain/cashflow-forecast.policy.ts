import { Decimal } from '@prisma/client/runtime/library';
import {
  CASHFLOW_MAX_PERIODS,
  type CashflowBucket,
  type CashflowBucketSize,
  type CashflowCurrencyForecast,
  type CashflowLineType,
} from '@erp/types';

import { utcMidnight } from '../../commercial/domain/commercial-workspace.policy.js';

/**
 * Pure rules for the cash-flow forecast (ADR-043 Phase 4): where a dated amount lands and how the
 * buckets add up. Every amount arrives already computed by the shared definitions (invoice and
 * bill `outstandingAmount`, `scheduleBaseValue` × percentage, the commitment ledger's stages);
 * this file only places it in time and sums it per currency.
 */

const DAY_MS = 86_400_000;
const ZERO = new Decimal(0);

/** Cap on the number of periods one request may span (104 weeks / 104 months). */
export const MAX_PERIODS = CASHFLOW_MAX_PERIODS;

/** A requested range the forecast refuses (the controller answers 400). */
export class CashflowRangeError extends Error {}

/** One amount the forecast places on a date (null = undated). */
export interface CashflowItem {
  line: CashflowLineType;
  currency: string;
  amount: Decimal;
  date: Date | null;
}

export interface CashflowPeriod {
  key: string;
  start: Date;
  /** Inclusive last day. */
  end: Date;
}

export interface CashflowGrid {
  size: CashflowBucketSize;
  periods: CashflowPeriod[];
  /** Anything dated before this day is `NOW` (overdue / due before the range). */
  nowBefore: Date;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (d: Date) => new Date(utcMidnight(d));

export function addDays(date: Date, days: number): Date {
  return new Date(utcMidnight(date) + days * DAY_MS);
}

/** The first day of the week (Monday, UTC) or month containing `date`. */
export function periodStart(date: Date, size: CashflowBucketSize): Date {
  const d = day(date);
  if (size === 'MONTH') return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const offset = (d.getUTCDay() + 6) % 7; // Monday = 0
  return addDays(d, -offset);
}

function nextPeriodStart(start: Date, size: CashflowBucketSize): Date {
  if (size === 'MONTH') return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  return addDays(start, 7);
}

/**
 * The periods from the one containing `from` through the one containing `to`. `from` before today
 * is read as today — a forecast looks forward; what is already late sits in `NOW`. `to` defaults to
 * 12 weeks or 6 months after `from`. A `to` before `from`, or a range of more than
 * {@link MAX_PERIODS} periods, is refused ({@link CashflowRangeError}) — never silently changed.
 */
export function buildGrid(input: { today: Date; from?: Date | null; to?: Date | null; size: CashflowBucketSize }): CashflowGrid {
  const today = day(input.today);
  const from = input.from && day(input.from) > today ? day(input.from) : today;
  const defaultTo =
    input.size === 'MONTH'
      ? new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 6, 0))
      : addDays(from, 12 * 7 - 1);
  const to = input.to ? day(input.to) : defaultTo;
  if (to < from) {
    throw new CashflowRangeError(`"to" (${iso(to)}) is before the forecast start (${iso(from)}; a past "from" reads as today).`);
  }

  const periods: CashflowPeriod[] = [];
  let start = periodStart(from, input.size);
  while (start <= to) {
    if (periods.length === MAX_PERIODS) {
      throw new CashflowRangeError(
        `The range spans more than ${MAX_PERIODS} ${input.size === 'MONTH' ? 'months' : 'weeks'}; shorten it.`,
      );
    }
    const next = nextPeriodStart(start, input.size);
    periods.push({ key: iso(start), start, end: addDays(next, -1) });
    start = next;
  }
  // Late items are those due before today; when the range starts later, also those before it.
  const firstStart = periods[0]!.start;
  const nowBefore = firstStart > today ? firstStart : today;
  return { size: input.size, periods, nowBefore };
}

/** The bucket key an item lands in. */
export function bucketKeyFor(date: Date | null, grid: CashflowGrid): string {
  if (!date) return 'UNDATED';
  const d = day(date);
  if (d < grid.nowBefore) return 'NOW';
  for (const p of grid.periods) if (d >= p.start && d <= p.end) return p.key;
  return 'LATER';
}

/**
 * When an unbilled stage is expected to bill: the stage's expected date as the payment schedule
 * defines it (`deriveExpectedDate`: milestone forecast → baseline; a dated stage's date), or the
 * day it was marked ready if that is earlier. An invoice is dated the day it is issued (owner
 * decision 2026-09-28, `redateForIssue`), so a date already past means "today". No date and not
 * ready → null (undated, never guessed).
 */
export function expectedBillDate(input: {
  expectedDate: string | null;
  readyToBillAt: Date | null;
  today: Date;
}): Date | null {
  const planned = input.expectedDate ? new Date(`${input.expectedDate}T00:00:00Z`) : null;
  const ready = input.readyToBillAt ? day(input.readyToBillAt) : null;
  const candidates = [planned, ready].filter((d): d is Date => d !== null);
  if (candidates.length === 0) return null;
  const earliest = candidates.reduce((a, b) => (a <= b ? a : b));
  const today = day(input.today);
  return earliest < today ? today : earliest;
}

/**
 * When an open purchase order is expected to be paid: its expected delivery date + the supplier's
 * payment terms (the rule a supplier bill's due date defaults to). Either missing → null (undated).
 */
export function expectedCommitmentPayDate(deliveryDate: Date | null, supplierTermsDays: number | null): Date | null {
  if (!deliveryDate || supplierTermsDays === null || supplierTermsDays === undefined) return null;
  return addDays(deliveryDate, supplierTermsDays);
}

type Sums = Record<CashflowLineType, Decimal>;
const emptySums = (): Sums => ({
  fromInvoices: ZERO,
  fromUnbilledStages: ZERO,
  fromOpeningReceivables: ZERO,
  fromSupplierBills: ZERO,
  fromOpenCommitments: ZERO,
  fromOpeningPayables: ZERO,
});
const emptyCounts = (): Record<CashflowLineType, number> => ({
  fromInvoices: 0,
  fromUnbilledStages: 0,
  fromOpeningReceivables: 0,
  fromSupplierBills: 0,
  fromOpenCommitments: 0,
  fromOpeningPayables: 0,
});
const inflowOf = (s: Sums) => s.fromInvoices.plus(s.fromUnbilledStages).plus(s.fromOpeningReceivables);
const outflowOf = (s: Sums) => s.fromSupplierBills.plus(s.fromOpenCommitments).plus(s.fromOpeningPayables);

/**
 * Sum the items per currency and bucket. Bucket order: NOW, the periods, LATER, UNDATED — every
 * bucket is present so the table and chart line up across currencies. `cumulativeNet` runs from
 * NOW through LATER; UNDATED has none. Amounts are null when money is hidden.
 */
export function buildForecast(items: CashflowItem[], grid: CashflowGrid, moneyVisible: boolean): CashflowCurrencyForecast[] {
  const byCurrency = new Map<string, { sums: Map<string, Sums>; counts: Record<CashflowLineType, number> }>();
  for (const item of items) {
    const entry = byCurrency.get(item.currency) ?? {
      sums: new Map<string, Sums>(),
      counts: emptyCounts(),
    };
    const key = bucketKeyFor(item.date, grid);
    const sums = entry.sums.get(key) ?? emptySums();
    sums[item.line] = sums[item.line].plus(item.amount);
    entry.sums.set(key, sums);
    entry.counts[item.line] += 1;
    byCurrency.set(item.currency, entry);
  }

  const money = (d: Decimal | null): string | null => (moneyVisible && d !== null ? d.toFixed(2) : null);
  const layout: { key: string; kind: CashflowBucket['kind']; start: string | null; end: string | null }[] = [
    { key: 'NOW', kind: 'NOW', start: null, end: iso(addDays(grid.nowBefore, -1)) },
    ...grid.periods.map((p) => ({ key: p.key, kind: 'PERIOD' as const, start: iso(p.start), end: iso(p.end) })),
    { key: 'LATER', kind: 'LATER', start: iso(addDays(grid.periods.at(-1)!.end, 1)), end: null },
    { key: 'UNDATED', kind: 'UNDATED', start: null, end: null },
  ];

  return [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, entry]) => {
      let running = ZERO;
      const total = emptySums();
      const buckets: CashflowBucket[] = layout.map((slot) => {
        const s = entry.sums.get(slot.key) ?? emptySums();
        for (const line of Object.keys(total) as CashflowLineType[]) total[line] = total[line].plus(s[line]);
        const inflow = inflowOf(s);
        const outflow = outflowOf(s);
        const net = inflow.minus(outflow);
        if (slot.kind !== 'UNDATED') running = running.plus(net);
        return {
          ...slot,
          inflows: {
            fromInvoices: money(s.fromInvoices),
            fromUnbilledStages: money(s.fromUnbilledStages),
            fromOpeningReceivables: money(s.fromOpeningReceivables),
            total: money(inflow),
          },
          outflows: {
            fromSupplierBills: money(s.fromSupplierBills),
            fromOpenCommitments: money(s.fromOpenCommitments),
            fromOpeningPayables: money(s.fromOpeningPayables),
            total: money(outflow),
          },
          net: money(net),
          cumulativeNet: slot.kind === 'UNDATED' ? null : money(running),
        };
      });
      const inflow = inflowOf(total);
      const outflow = outflowOf(total);
      return {
        currency,
        buckets,
        totals: {
          inflows: {
            fromInvoices: money(total.fromInvoices),
            fromUnbilledStages: money(total.fromUnbilledStages),
            fromOpeningReceivables: money(total.fromOpeningReceivables),
            total: money(inflow),
          },
          outflows: {
            fromSupplierBills: money(total.fromSupplierBills),
            fromOpenCommitments: money(total.fromOpenCommitments),
            fromOpeningPayables: money(total.fromOpeningPayables),
            total: money(outflow),
          },
          net: money(inflow.minus(outflow)),
        },
        counts: entry.counts,
      };
    });
}
