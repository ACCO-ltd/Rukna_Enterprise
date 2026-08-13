'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, FormField, Input } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

import { useProfitLoss } from '../hooks/use-accounting';
import type { ProfitLossSection } from '../types';

/** First and last day of the current month — the range a P&L is asked for most often. */
function currentMonth(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

export function ProfitLossReport() {
  const t = useTranslations('accounting.profitLoss');
  const tCommon = useTranslations('accounting.common');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [range, setRange] = useState(currentMonth);

  const report = useProfitLoss(range.from, range.to);

  const netMinor = toMinorUnits(report.data?.netIncome, MONEY_SCALE);
  const revenueMinor = toMinorUnits(report.data?.revenue.total, MONEY_SCALE);
  const grossMinor = toMinorUnits(report.data?.grossProfit, MONEY_SCALE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <FormField htmlFor="pl-from" label={tCommon('fromDate')} className="sm:w-56">
          <Input
            id="pl-from"
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </FormField>

        <FormField htmlFor="pl-to" label={tCommon('toDate')} className="sm:w-56">
          <Input
            id="pl-to"
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </FormField>
      </div>

      {report.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tShared('loading')}</span>
          <div
            className="h-64 animate-pulse rounded-lg border border-border bg-muted"
            aria-hidden="true"
          />
        </div>
      ) : report.isError ? (
        <Alert variant="error" messages={[t('loadFailed')]} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {tCommon('generatedAt', {
              timestamp: formatDate(report.data.generatedAt, locale) ?? report.data.generatedAt,
            })}
            {' · '}
            {t('closingExcludedNote')}
          </p>

          {/* An empty P&L and a P&L of zero are different facts, and the distinguishing
              signal is whether any section carries a line at all. */}
          {report.data.revenue.lines.length === 0 &&
          report.data.costOfSales.lines.length === 0 &&
          report.data.expenses.lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Section section={report.data.revenue} label={t('revenue')} locale={locale} />
              <Section
                section={report.data.costOfSales}
                label={t('costOfSales')}
                locale={locale}
              />

              <Subtotal
                label={t('grossProfit')}
                amount={report.data.grossProfit}
                locale={locale}
                // Margin is the number a CEO reads first, and it is not on the response.
                // Suppressed at zero revenue rather than shown as 0% or NaN%.
                note={
                  revenueMinor > 0
                    ? t('grossMarginLabel', {
                        percent: ((grossMinor / revenueMinor) * 100).toFixed(1),
                      })
                    : undefined
                }
              />

              <Section section={report.data.expenses} label={t('expenses')} locale={locale} />

              {/* A loss is named a loss. Rendering "Net Income −40,000" makes the reader do
                  the sign in their head, and that is the line they are looking for. */}
              <Subtotal
                label={netMinor < 0 ? t('netLoss') : t('netIncome')}
                amount={report.data.netIncome}
                locale={locale}
                emphasis
                negative={netMinor < 0}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function Section({
  section,
  label,
  locale,
}: {
  section: ProfitLossSection;
  label: string;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('accounting.profitLoss');

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{label}</h2>
        <p className="text-sm font-semibold text-foreground">
          <bdi className="tabular-nums">{formatMoney(section.total, undefined, locale)}</bdi>
        </p>
      </div>

      {section.lines.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('sectionEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {section.lines.map((line) => (
            <li
              key={line.accountId}
              className="flex flex-col gap-1 px-4 py-2.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
            >
              <div className="min-w-0">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  {line.accountCode}
                </span>
                <span className="ms-2 text-sm text-foreground">{line.accountName}</span>
              </div>
              <span className="text-sm text-foreground">
                <bdi className="tabular-nums">{formatMoney(line.amount, undefined, locale)}</bdi>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Subtotal({
  label,
  amount,
  locale,
  note,
  emphasis,
  negative,
}: {
  label: string;
  amount: string;
  locale: 'en' | 'ar';
  note?: string | undefined;
  emphasis?: boolean;
  negative?: boolean;
}) {
  return (
    <div
      className={
        emphasis
          ? 'flex flex-wrap items-baseline justify-between gap-3 rounded-lg border-2 border-brand-primary/30 bg-brand-primary/5 px-4 py-4'
          : 'flex flex-wrap items-baseline justify-between gap-3 rounded-lg border border-border bg-muted px-4 py-3'
      }
    >
      <div>
        <p
          className={
            emphasis ? 'text-base font-semibold text-foreground' : 'text-sm font-semibold text-foreground'
          }
        >
          {label}
        </p>
        {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
      </div>

      <p
        className={
          negative
            ? 'text-lg font-semibold text-danger'
            : emphasis
              ? 'text-lg font-semibold text-foreground'
              : 'text-sm font-semibold text-foreground'
        }
      >
        <bdi className="tabular-nums">{formatMoney(amount, undefined, locale)}</bdi>
      </p>
    </div>
  );
}
