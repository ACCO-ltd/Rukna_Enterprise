~'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, FormField, Input } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { useBalanceSheet } from '../hooks/use-accounting';
import type { BalanceSheetSection } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function BalanceSheetReport() {
  const t = useTranslations('accounting.balanceSheet');
  const tCommon = useTranslations('accounting.common');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [asOfDate, setAsOfDate] = useState(today);
  const [comparativeDate, setComparativeDate] = useState('');

  const report = useBalanceSheet(asOfDate, comparativeDate || undefined);
  const comparing = Boolean(comparativeDate) && Boolean(report.data?.comparativeDate);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <FormField htmlFor="bs-date" label={tCommon('asOfDate')} className="sm:w-56">
          <Input
            id="bs-date"
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </FormField>

        <FormField htmlFor="bs-comparative" label={t('comparativeLabel')} className="sm:w-56">
          <Input
            id="bs-comparative"
            type="date"
            value={comparativeDate}
            onChange={(e) => setComparativeDate(e.target.value)}
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
          {/* Assets = Liabilities + Equity is an identity, not a target. If it fails, the
              ledger holds an entry that should not exist, and every figure below is suspect
              until that is explained — so it leads, in error tone. */}
          {report.data.balanced ? null : (
            <Alert
              variant="error"
              messages={[
                t('notBalancedHint', {
                  assets:
                    formatMoney(report.data.assets.total, undefined, locale) ??
                    report.data.assets.total,
                  liabilitiesAndEquity:
                    formatMoney(report.data.totalLiabilitiesAndEquity, undefined, locale) ??
                    report.data.totalLiabilitiesAndEquity,
                }),
              ]}
            />
          )}

          <p className="text-xs text-muted-foreground">
            {tCommon('generatedAt', {
              timestamp: formatDate(report.data.generatedAt, locale) ?? report.data.generatedAt,
            })}
          </p>

          {report.data.assets.lines.length === 0 &&
          report.data.liabilities.lines.length === 0 &&
          report.data.equity.lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <Section
                section={report.data.assets}
                label={t('assets')}
                locale={locale}
                comparing={comparing}
              />
              <Section
                section={report.data.liabilities}
                label={t('liabilities')}
                locale={locale}
                comparing={comparing}
              />
              <Section
                section={report.data.equity}
                label={t('equity')}
                locale={locale}
                comparing={comparing}
              />

              <div className="flex flex-wrap items-baseline justify-between gap-3 rounded-lg border-2 border-brand-primary/30 bg-brand-primary/5 px-4 py-4">
                <p className="text-base font-semibold text-foreground">
                  {t('totalLiabilitiesAndEquity')}
                </p>
                <p className="text-lg font-semibold text-foreground">
                  <bdi className="tabular-nums">
                    {formatMoney(report.data.totalLiabilitiesAndEquity, undefined, locale)}
                  </bdi>
                </p>
              </div>

              {/* Why the sheet balances mid-year. Without this, a reader reconciling equity
                  against the trial balance finds a figure that is on no account. */}
              <p className="max-w-prose text-xs text-muted-foreground">
                {t('currentYearEarningsNote')}
              </p>
            </div>
          )}

          <p
            className={
              report.data.balanced
                ? 'text-sm font-medium text-brand-primary'
                : 'text-sm font-medium text-danger'
            }
            aria-live="polite"
          >
            {report.data.balanced ? t('balanced') : t('notBalanced')}
          </p>
        </>
      )}
    </div>
  );
}

function Section({
  section,
  label,
  locale,
  comparing,
}: {
  section: BalanceSheetSection;
  label: string;
  locale: 'en' | 'ar';
  comparing: boolean;
}) {
  const t = useTranslations('accounting.balanceSheet');

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-surface">
      <div className="flex items-baseline justify-between gap-4 border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">{label}</h2>
        <div className="flex items-baseline gap-6">
          {comparing ? (
            <p className="text-sm text-muted-foreground">
              <bdi className="tabular-nums">
                {formatMoney(section.comparativeTotal, undefined, locale)}
              </bdi>
            </p>
          ) : null}
          <p className="text-sm font-semibold text-foreground">
            <bdi className="tabular-nums">{formatMoney(section.total, undefined, locale)}</bdi>
          </p>
        </div>
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
              <div className="flex items-baseline gap-6">
                {comparing ? (
                  <span className="text-sm text-muted-foreground">
                    <bdi className="tabular-nums">
                      {formatMoney(line.comparativeBalance, undefined, locale)}
                    </bdi>
                  </span>
                ) : null}
                <span className="text-sm text-foreground">
                  <bdi className="tabular-nums">
                    {formatMoney(line.balance, undefined, locale)}
                  </bdi>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
