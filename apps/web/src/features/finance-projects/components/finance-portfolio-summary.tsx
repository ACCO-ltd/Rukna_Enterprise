'use client';

import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  FinancePortfolioQueue,
  FinancePortfolioResponse,
  FinancePortfolioRow,
  FinancePortfolioTotals,
} from '@erp/types';
import { Button, Panel, Skeleton } from '@erp/ui';

import { MetricStrip, type Metric } from '@/components/widget/metric-strip';
import { formatMoney } from '@/lib/format';

import { barPercent, isPositive, minor, share } from '../figures';
import { financeProjectRedirects } from '../redirects';
import { ChartLegend, SegmentBar } from './finance-project-charts';

type Locale = 'en' | 'ar';

/**
 * What each morning queue reads from a portfolio row and from a currency's totals, and where its
 * next step lives — one table, so the cards never disagree with themselves.
 */
const QUEUE_SPEC: Record<
  FinancePortfolioQueue,
  {
    key: 'toBill' | 'overdue' | 'toPay';
    rowAmount: (row: FinancePortfolioRow) => string | null;
    inQueue: (row: FinancePortfolioRow) => boolean;
    totalAmount: (totals: FinancePortfolioTotals) => string | null;
    totalCount: (totals: FinancePortfolioTotals) => number;
    href: (projectId: string) => string;
  }
> = {
  TO_BILL: {
    key: 'toBill',
    rowAmount: (row) => row.readyToBill.amount,
    inQueue: (row) => row.readyToBill.count > 0,
    totalAmount: (totals) => totals.readyToBill.amount,
    totalCount: (totals) => totals.readyToBill.count,
    href: financeProjectRedirects.billing,
  },
  OVERDUE: {
    key: 'overdue',
    rowAmount: (row) => row.overdue,
    inQueue: (row) => row.overdueInvoices.count > 0,
    totalAmount: (totals) => totals.overdue,
    totalCount: (totals) => totals.overdueInvoices.count,
    href: financeProjectRedirects.billing,
  },
  TO_PAY: {
    key: 'toPay',
    rowAmount: (row) => row.billsToPay.amount,
    inQueue: (row) => row.billsToPay.count > 0,
    totalAmount: (totals) => totals.billsToPay.amount,
    totalCount: (totals) => totals.billsToPay.count,
    href: (projectId) => financeProjectRedirects.transactions(projectId, 'bills'),
  },
};

/** The rows a queue card lists: those with something in the queue, largest amount first. */
export function topRows(
  rows: readonly FinancePortfolioRow[],
  queue: FinancePortfolioQueue,
  limit = 3,
): FinancePortfolioRow[] {
  const spec = QUEUE_SPEC[queue];
  return rows
    .filter(spec.inQueue)
    .sort((a, b) => minor(spec.rowAmount(b)) - minor(spec.rowAmount(a)))
    .slice(0, limit);
}

/**
 * The currency the charts draw: the one with the most projects. Money in different currencies is
 * never put on one scale; projects in any other currency stay in the table.
 */
export function chartCurrency(data: FinancePortfolioResponse): string | null {
  const priced = data.totals.filter((t) => t.currency !== null);
  if (priced.length === 0) return null;
  return [...priced].sort((a, b) => b.projectCount - a.projectCount)[0]!.currency;
}

// ─── Totals ──────────────────────────────────────────────────────────────────

/** One strip per currency — the portfolio's money, as the Dashboard's figure strips read. */
export function PortfolioTotals({ data }: { data: FinancePortfolioResponse | undefined }) {
  const t = useTranslations('finance.projects.landing.totals');
  const locale = useLocale() as Locale;
  if (!data) return <Skeleton className="h-24 w-full rounded-panel" />;

  const hidden = !data.moneyVisible;
  // Money withheld: every sublabel says so, rather than "nothing billed" over a blank.
  const restricted = hidden ? t('restricted') : undefined;
  const priced = data.totals.filter((totals) => totals.currency !== null);
  const unpriced = data.totals.find((totals) => totals.currency === null)?.projectCount ?? 0;

  return (
    <div className="space-y-2" role="group" aria-label={t('label')}>
      {priced.map((totals) => {
        const currency = totals.currency!;
        const money = (value: string | null) => (hidden || value === null ? null : formatMoney(value, currency, locale));
        const billedShare = share(totals.billedExclTax, totals.contractValue);
        const collectedShare = share(totals.collected, totals.billed);
        const metrics: Metric[] = [
          { label: t('contract', { currency }), value: money(totals.contractValue), sublabel: t('projects', { count: totals.projectCount }) },
          {
            label: t('billed'),
            value: money(totals.billedExclTax),
            sublabel: restricted ?? (billedShare === null ? t('nothingBilled') : t('ofContract', { percent: billedShare })),
          },
          {
            label: t('collected'),
            value: money(totals.collected),
            sublabel: restricted ?? (collectedShare === null ? t('nothingToCollect') : t('ofBilled', { percent: collectedShare })),
          },
          { label: t('outstanding'), value: money(totals.outstanding), sublabel: restricted ?? t('owedByClients') },
          {
            label: t('overdue'),
            value: money(totals.overdue),
            ...(totals.overdueInvoices.count > 0
              ? { sublabel: t('overdueInvoices', { count: totals.overdueInvoices.count }), sublabelTone: 'danger' as const }
              : { sublabel: t('nothingOverdue') }),
          },
          {
            label: t('toPay'),
            value: money(totals.billsToPay.amount),
            sublabel: totals.billsToPay.count > 0 ? t('bills', { count: totals.billsToPay.count }) : t('nothingToPay'),
          },
        ];
        return (
          <MetricStrip
            key={currency}
            columns={3}
            labelStyle="sentence"
            aria-label={t('stripLabel', { currency })}
            metrics={metrics}
          />
        );
      })}
      {unpriced > 0 ? <p className="text-caption text-muted-foreground">{t('noContract', { count: unpriced })}</p> : null}
    </div>
  );
}

// ─── The three morning queues ────────────────────────────────────────────────

/**
 * To bill · Overdue · To pay (ADR-043 decision 5) as three cards: what is waiting, how much, and the
 * three largest projects with the next step beside each. "Show all" filters the table below.
 */
export function QueueCards({
  data,
  onShowAll,
}: {
  data: FinancePortfolioResponse | undefined;
  onShowAll: (queue: FinancePortfolioQueue) => void;
}) {
  const t = useTranslations('finance.projects.landing.queues');
  if (!data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-56 w-full rounded-panel" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid items-start gap-4 md:grid-cols-3" role="group" aria-label={t('label')}>
      {(['TO_BILL', 'OVERDUE', 'TO_PAY'] as const).map((queue) => (
        <QueueCard key={queue} queue={queue} data={data} onShowAll={() => onShowAll(queue)} />
      ))}
    </div>
  );
}

function QueueCard({
  queue,
  data,
  onShowAll,
}: {
  queue: FinancePortfolioQueue;
  data: FinancePortfolioResponse;
  onShowAll: () => void;
}) {
  const t = useTranslations('finance.projects.landing.queues');
  const locale = useLocale() as Locale;
  const spec = QUEUE_SPEC[queue];
  const hidden = !data.moneyVisible;
  const projectCount = data.queueCounts[queue];
  const rows = topRows(data.items, queue);

  // Per-currency totals of this queue — never added across currencies.
  const amounts = data.totals
    .filter((totals) => totals.currency !== null)
    .map((totals) => {
      const value = spec.totalAmount(totals);
      return hidden || !isPositive(value) ? null : formatMoney(value, totals.currency!, locale);
    })
    .filter((v): v is string => Boolean(v));
  const itemCount = data.totals.reduce((sum, totals) => sum + spec.totalCount(totals), 0);

  const rowAmount = (row: FinancePortfolioRow) => {
    const value = spec.rowAmount(row);
    return hidden || value === null || !row.currency ? null : formatMoney(value, row.currency, locale);
  };
  const rowDetail = (row: FinancePortfolioRow) =>
    queue === 'TO_BILL'
      ? t('toBill.stages', { count: row.readyToBill.count })
      : queue === 'OVERDUE'
        ? t('overdue.age', { count: row.overdueInvoices.count, days: row.overdueInvoices.oldestDaysPastDue ?? 0 })
        : t('toPay.bills', { count: row.billsToPay.count });

  return (
    <Panel
      title={t(`${spec.key}.title`)}
      sub={projectCount > 0 ? t(`${spec.key}.sub`, { count: itemCount, projects: projectCount }) : undefined}
      flush
    >
      {projectCount === 0 ? (
        <p className="flex items-center gap-2 px-4 py-6 text-body-sm text-muted-foreground">
          <CheckCircle2 size={16} className="shrink-0 text-success" aria-hidden="true" />
          {t(`${spec.key}.empty`)}
        </p>
      ) : (
        <>
          <p className={`px-4 pt-3 text-h2 font-bold tabular-nums ${queue === 'OVERDUE' ? 'text-danger' : 'text-foreground'}`}>
            {amounts.length > 0 ? amounts.join(' · ') : '—'}
          </p>
          <ul className="mt-2">
            {rows.map((row) => (
              <li key={row.projectId} className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
                <div className="min-w-0">
                  <Link
                    href={spec.href(row.projectId)}
                    className="block truncate text-body-sm font-medium text-foreground hover:text-brand-primary hover:underline"
                  >
                    {row.name}
                  </Link>
                  <p className="truncate text-caption text-muted-foreground">{rowDetail(row)}</p>
                </div>
                <span className="shrink-0 text-body-sm tabular-nums text-foreground">{rowAmount(row) ?? '—'}</span>
              </li>
            ))}
          </ul>
          <div className="border-t border-border px-2 py-1.5">
            <Button variant="ghost" size="sm" onClick={onShowAll}>
              {t('showAll', { count: projectCount })}
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

// ─── Charts ──────────────────────────────────────────────────────────────────

/**
 * Two charts over the projects of the chart currency: how far billing has got against each
 * contract, and who owes the most (with the overdue part). Each row prints its figures — the bar
 * is only the shape.
 */
export function PortfolioCharts({ data }: { data: FinancePortfolioResponse | undefined }) {
  const t = useTranslations('finance.projects.landing.charts');
  const locale = useLocale() as Locale;
  if (!data || !data.moneyVisible) return null;
  const currency = chartCurrency(data);
  if (!currency) return null;

  const rows = data.items.filter((row) => row.currency === currency);
  const money = (value: string | null) => formatMoney(value, currency, locale) ?? '—';
  const others = data.totals.filter((totals) => totals.currency !== null && totals.currency !== currency).length > 0;

  const billing = rows
    .filter((row) => isPositive(row.contractValue))
    .sort((a, b) => minor(b.contractValue) - minor(a.contractValue))
    .slice(0, 8);
  const owed = rows
    .filter((row) => isPositive(row.outstanding))
    .sort((a, b) => minor(b.outstanding) - minor(a.outstanding))
    .slice(0, 8);
  const maxOwed = owed[0]?.outstanding ?? null;
  const note = others ? t('otherCurrencies', { currency }) : t('inCurrency', { currency });

  return (
    <div className="grid items-start gap-6 xl:grid-cols-2">
      <Panel title={t('billing.title')} sub={note} flush>
        {billing.length === 0 ? (
          <p className="px-4 py-4 text-body-sm text-muted-foreground">{t('billing.empty')}</p>
        ) : (
          <ul aria-label={t('billing.title')}>
            {billing.map((row) => {
              const billed = share(row.billedExclTax, row.contractValue) ?? 0;
              return (
                <li key={row.projectId} className="border-b border-border px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <Link
                      href={financeProjectRedirects.overview(row.projectId)}
                      className="min-w-0 truncate text-body-sm font-medium text-foreground hover:text-brand-primary hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {t('billing.figure', { billed: money(row.billedExclTax), contract: money(row.contractValue), percent: billed })}
                    </span>
                  </div>
                  <SegmentBar
                    className="mt-1.5"
                    segments={[{ percent: barPercent(row.billedExclTax, row.contractValue), colour: 'chart-1' }]}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={t('owed.title')} sub={note} flush>
        {owed.length === 0 ? (
          <p className="px-4 py-4 text-body-sm text-muted-foreground">{t('owed.empty')}</p>
        ) : (
          <>
            <ul aria-label={t('owed.title')}>
              {owed.map((row) => (
                <li key={row.projectId} className="border-b border-border px-4 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <Link
                      href={financeProjectRedirects.billing(row.projectId)}
                      className="min-w-0 truncate text-body-sm font-medium text-foreground hover:text-brand-primary hover:underline"
                    >
                      {row.name}
                    </Link>
                    <span className="shrink-0 text-caption tabular-nums text-muted-foreground">
                      {money(row.outstanding)}
                      {isPositive(row.overdue) ? <span className="text-danger"> · {t('owed.overdue', { amount: money(row.overdue) })}</span> : null}
                    </span>
                  </div>
                  {/* The bar's length is this project's share of the largest balance — a data width. */}
                  <span className="mt-1.5 block" style={{ width: `${Math.max(barPercent(row.outstanding, maxOwed), 2)}%` }}>
                    <SegmentBar
                      segments={[
                        { percent: barPercent(row.overdue, row.outstanding), colour: 'chart-4' },
                        { percent: 100 - barPercent(row.overdue, row.outstanding), colour: 'chart-1' },
                      ]}
                    />
                  </span>
                </li>
              ))}
            </ul>
            <ChartLegend
              className="border-t border-border px-4 py-2.5"
              items={[
                { label: t('owed.legendOverdue'), colour: 'chart-4' },
                { label: t('owed.legendNotDue'), colour: 'chart-1' },
              ]}
            />
          </>
        )}
      </Panel>
    </div>
  );
}
