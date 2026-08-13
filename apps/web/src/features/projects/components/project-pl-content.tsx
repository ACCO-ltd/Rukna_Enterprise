'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, FormField, Input } from '@erp/ui';

import { formatDate } from '@/lib/format';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';
import { useProjectActualPl } from '@/features/accounting/hooks/use-accounting';
import { Section, Subtotal } from '@/features/accounting/components/profit-loss';

/** Year-to-date is the range a project P&L is asked for most often. */
function currentYear(): { from: string; to: string } {
  const now = new Date();
  const first = new Date(now.getFullYear(), 0, 1);
  return { from: first.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10) };
}

/**
 * Project Actual P&L (ADR-013) — posted GL truth only, scoped to one project.
 * Deliberately excludes committed/forecast cost (that is the separate Project Financial
 * Position). The header says so; do not present this as the complete margin picture.
 */
export function ProjectPlContent({ projectId }: { projectId: string }) {
  const t = useTranslations('accounting.projectActualPl');
  const tPl = useTranslations('accounting.profitLoss');
  const tCommon = useTranslations('accounting.common');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [range, setRange] = useState(currentYear);
  const report = useProjectActualPl(projectId, range.from, range.to);

  const netMinor = toMinorUnits(report.data?.netIncome, MONEY_SCALE);
  const revenueMinor = toMinorUnits(report.data?.revenue.total, MONEY_SCALE);
  const grossMinor = toMinorUnits(report.data?.grossProfit, MONEY_SCALE);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 max-w-prose text-sm text-warning">{t('actualOnlyHint')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <FormField htmlFor="ppl-from" label={tCommon('fromDate')} className="sm:w-56">
          <Input
            id="ppl-from"
            type="date"
            value={range.from}
            onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
          />
        </FormField>
        <FormField htmlFor="ppl-to" label={tCommon('toDate')} className="sm:w-56">
          <Input
            id="ppl-to"
            type="date"
            value={range.to}
            onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
          />
        </FormField>
      </div>

      {report.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tShared('loading')}</span>
          <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
        </div>
      ) : report.isError ? (
        <Alert variant="error" messages={[tPl('loadFailed')]} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            {tCommon('generatedAt', {
              timestamp: formatDate(report.data.generatedAt, locale) ?? report.data.generatedAt,
            })}
            {' · '}
            {tPl('closingExcludedNote')}
          </p>

          {report.data.revenue.lines.length === 0 &&
          report.data.costOfSales.lines.length === 0 &&
          report.data.expenses.lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">{t('emptyHint')}</p>
            </div>
          ) : (
            <div className="space-y-4">
              <Section section={report.data.revenue} label={tPl('revenue')} locale={locale} />
              <Section section={report.data.costOfSales} label={tPl('costOfSales')} locale={locale} />
              <Subtotal
                label={tPl('grossProfit')}
                amount={report.data.grossProfit}
                locale={locale}
                note={
                  revenueMinor > 0
                    ? tPl('grossMarginLabel', { percent: ((grossMinor / revenueMinor) * 100).toFixed(1) })
                    : undefined
                }
              />
              <Section section={report.data.expenses} label={tPl('expenses')} locale={locale} />
              <Subtotal
                label={netMinor < 0 ? tPl('netLoss') : tPl('netIncome')}
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
