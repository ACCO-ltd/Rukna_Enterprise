'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { LtrValue, Panel } from '@erp/ui';
import type { DashboardFigures } from '@erp/types';

import { MetricStrip } from '@/components/widget/metric-strip';
import { formatMoney } from '@/lib/format';

type Locale = 'en' | 'ar';

/**
 * The four figures someone would act on (P31), one strip per currency — money is never added
 * across currencies. The caller renders this only for money roles once something is counted.
 */
export function DashboardFigureStrips({ figures }: { figures: readonly DashboardFigures[] }) {
  const t = useTranslations('platform.dashboard.figures');
  const locale = useLocale() as Locale;
  const money = (value: string, currency: string) => formatMoney(value, currency, locale);

  return (
    <div className="space-y-3">
      {figures.map((f) => (
        <MetricStrip
          key={f.currency}
          columns={4}
          labelStyle="sentence"
          aria-label={
            figures.length > 1 ? t('currencyLabel', { currency: f.currency }) : t('label')
          }
          metrics={[
            {
              label: t('contractValue'),
              value: money(f.contractValueInProgress, f.currency),
              sublabel: t('activeProjects', { count: f.activeProjectCount }),
            },
            {
              label: t('clientsOwe'),
              value: money(f.receivables.outstanding, f.currency),
              sublabel: t('unpaidInvoices', { count: f.receivables.unpaidInvoiceCount }),
            },
            {
              label: t('overdue'),
              value: money(f.receivables.overdue, f.currency),
              ...(f.receivables.overdueInvoiceCount > 0
                ? {
                    sublabel: t('overdueSub', {
                      count: f.receivables.overdueInvoiceCount,
                      days: f.receivables.oldestDaysLate ?? 0,
                    }),
                    sublabelTone: 'danger' as const,
                  }
                : { sublabel: t('nothingOverdue') }),
            },
            {
              label: t('weOwe'),
              value: money(f.payables.outstanding, f.currency),
              sublabel: t('dueThisWeek', {
                amount: money(f.payables.dueThisWeek, f.currency) ?? '',
              }),
            },
          ]}
        />
      ))}
    </div>
  );
}

/** Receivables by age: four rows, not a chart. Late buckets with money in them read in danger. */
export function ReceivablesByAge({ figures }: { figures: readonly DashboardFigures[] }) {
  const t = useTranslations('platform.dashboard.aging');
  const locale = useLocale() as Locale;
  const rows = [
    { key: 'notDue', late: false },
    { key: 'days1To30', late: true },
    { key: 'days31To60', late: true },
    { key: 'over60', late: true },
  ] as const;

  return (
    <Panel
      title={t('title')}
      action={
        <Link
          href="/finance/accounting/invoices"
          className="font-medium text-brand-primary hover:underline"
        >
          {t('link')}
        </Link>
      }
      flush
    >
      {figures.map((f) => (
        <dl key={f.currency} className="divide-y divide-border">
          {rows.map(({ key, late }) => {
            const amount = f.receivables.aging[key];
            const hasMoney = Number(amount) > 0;
            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 px-4 py-2.5 text-body-sm"
              >
                <dt className="text-muted-foreground">
                  {t(key)}
                  {figures.length > 1 ? ` · ${f.currency}` : null}
                </dt>
                <LtrValue
                  as="dd"
                  className={`font-semibold tabular-nums ${late && hasMoney ? 'text-danger' : 'text-foreground'}`}
                >
                  {formatMoney(amount, f.currency, locale)}
                </LtrValue>
              </div>
            );
          })}
        </dl>
      ))}
    </Panel>
  );
}
