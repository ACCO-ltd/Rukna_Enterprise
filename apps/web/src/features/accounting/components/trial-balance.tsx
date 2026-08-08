'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  FormField,
  Input,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { useTrialBalance } from '../hooks/use-accounting';
import type { TrialBalanceLine } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TrialBalanceReport() {
  const t = useTranslations('accounting.trialBalance');
  const tCommon = useTranslations('accounting.common');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const [asOfDate, setAsOfDate] = useState(today);
  const [includeZero, setIncludeZero] = useState(false);

  const report = useTrialBalance(asOfDate, includeZero);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <FormField htmlFor="tb-date" label={tCommon('asOfDate')} className="sm:w-56">
          <Input
            id="tb-date"
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
          />
        </FormField>

        <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="size-4 rounded border-border"
            checked={includeZero}
            onChange={(e) => setIncludeZero(e.target.checked)}
          />
          {t('includeZero')}
        </label>
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
          {/* A trial balance that does not balance means the ledger holds an entry that
              should not exist. It is stated first, in error tone, because everything below
              it is unreliable until it is explained. */}
          {report.data.balanced ? null : (
            <Alert
              variant="error"
              messages={[
                t('notBalancedHint', {
                  debit:
                    formatMoney(report.data.totalClosingDebit, undefined, locale) ??
                    report.data.totalClosingDebit,
                  credit:
                    formatMoney(report.data.totalClosingCredit, undefined, locale) ??
                    report.data.totalClosingCredit,
                }),
              ]}
            />
          )}

          <p className="text-xs text-muted-foreground">
            {tCommon('generatedAt', {
              timestamp: formatDate(report.data.generatedAt, locale) ?? report.data.generatedAt,
            })}
            {' · '}
            {t('snapshotNote')}
          </p>

          {report.data.lines.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
            </div>
          ) : (
            <TableScroll aria-label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[200px]">{t('colAccount')}</TableHead>
                    <TableHead numeric>{t('colOpeningDebit')}</TableHead>
                    <TableHead numeric>{t('colOpeningCredit')}</TableHead>
                    <TableHead numeric>{t('colPeriodDebit')}</TableHead>
                    <TableHead numeric>{t('colPeriodCredit')}</TableHead>
                    <TableHead numeric>{t('colClosingDebit')}</TableHead>
                    <TableHead numeric>{t('colClosingCredit')}</TableHead>
                  </TableRow>
                </TableHeader>

                <TableBody>
                  {report.data.lines.map((line) => (
                    <TrialBalanceRow key={line.accountId} line={line} locale={locale} />
                  ))}

                  <TableRow>
                    <TableCell className="min-w-[200px]">
                      <span className="text-sm font-semibold text-foreground">{t('totals')}</span>
                    </TableCell>
                    {[
                      report.data.totalOpeningDebit,
                      report.data.totalOpeningCredit,
                      report.data.totalPeriodDebit,
                      report.data.totalPeriodCredit,
                      report.data.totalClosingDebit,
                      report.data.totalClosingCredit,
                    ].map((total, i) => (
                      <TableCell key={i} numeric>
                        <bdi className="text-sm font-semibold tabular-nums">
                          {formatMoney(total, undefined, locale)}
                        </bdi>
                      </TableCell>
                    ))}
                  </TableRow>
                </TableBody>
              </Table>
            </TableScroll>
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

function TrialBalanceRow({
  line,
  locale,
}: {
  line: TrialBalanceLine;
  locale: 'en' | 'ar';
}) {
  return (
    <TableRow>
      <TableCell className="min-w-[200px]">
        <span className="font-mono text-xs text-muted-foreground tabular-nums">
          {line.accountCode}
        </span>
        <span className="ms-2 text-sm text-foreground">{line.accountName}</span>
      </TableCell>

      {[
        line.openingDebit,
        line.openingCredit,
        line.periodDebit,
        line.periodCredit,
        line.closingDebit,
        line.closingCredit,
      ].map((amount, i) => (
        <TableCell key={i} numeric>
          <bdi className="tabular-nums">{formatMoney(amount, undefined, locale)}</bdi>
        </TableCell>
      ))}
    </TableRow>
  );
}
