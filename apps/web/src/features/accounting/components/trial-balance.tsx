'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  CheckboxField,
  DatePicker,
  FilterBar,
  FilterField,
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
import { exportCsv, reportFilename } from '../lib/export-csv';
import { ledgerHref } from '../lib/report-links';
import type { TrialBalanceLine } from '../types';
import { ReportActions } from './report-actions';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function TrialBalanceReport() {
  const t = useTranslations('accounting.trialBalance');
  const tCommon = useTranslations('accounting.common');
  const tShared = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const router = useRouter();

  const [asOfDate, setAsOfDate] = useState(today);
  const [includeZero, setIncludeZero] = useState(false);
  const includeZeroId = useId();

  const report = useTrialBalance(asOfDate, includeZero);

  const handleExport = () => {
    if (!report.data) return;
    const rows = report.data.lines.map((line) => [
      line.accountCode,
      line.accountName,
      line.openingDebit,
      line.openingCredit,
      line.periodDebit,
      line.periodCredit,
      line.closingDebit,
      line.closingCredit,
    ]);
    exportCsv(
      reportFilename('trial-balance', asOfDate),
      [
        t('csvCode'),
        t('csvName'),
        t('colOpeningDebit'),
        t('colOpeningCredit'),
        t('colPeriodDebit'),
        t('colPeriodCredit'),
        t('colClosingDebit'),
        t('colClosingCredit'),
      ],
      rows,
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar>
          <FilterField id="tb-date" label={tCommon('asOfDate')}>
            <DatePicker
              id="tb-date"
              value={asOfDate}
              onChange={(value) => setAsOfDate(value)}
            />
          </FilterField>

          <CheckboxField
            id={includeZeroId}
            label={t('includeZero')}
            checked={includeZero}
            onChange={(e) => setIncludeZero(e.target.checked)}
          />
        </FilterBar>

        <ReportActions onExport={handleExport} exportDisabled={!report.data?.lines.length} />
      </div>

      {report.isPending ? (
        <div role="status" aria-live="polite">
          <span className="sr-only">{tShared('loading')}</span>
          <div
            className="h-64 animate-pulse rounded-panel border border-border bg-muted"
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
            {report.data.lines.length > 0 ? ` · ${t('drillHint')}` : ''}
          </p>

          {report.data.lines.length === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
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
                    <TableHead className="min-w-50">{t('colAccount')}</TableHead>
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
                    <TrialBalanceRow
                      key={line.accountId}
                      line={line}
                      locale={locale}
                      asOfDate={asOfDate}
                      onOpen={(href) => router.push(href)}
                      openLabel={t('openLedger', { account: line.accountName })}
                    />
                  ))}

                  <TableRow>
                    <TableCell className="min-w-50">
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
  asOfDate,
  onOpen,
  openLabel,
}: {
  line: TrialBalanceLine;
  locale: 'en' | 'ar';
  asOfDate: string;
  onOpen: (href: string) => void;
  openLabel: string;
}) {
  // A trial-balance figure is cumulative to the as-of date, so its ledger runs from inception
  // up to that date — `to = asOfDate`, `from` far enough back to include everything.
  const href = ledgerHref(line.accountId, { to: asOfDate });

  return (
    <TableRow className="cursor-pointer hover:bg-surface-subtle" onClick={() => onOpen(href)}>
      <TableCell className="min-w-50">
        {/* The row's one real link — keyboard, screen reader and open-in-new-tab use it; the
            row click mirrors it for the rest of the width. */}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onOpen(href);
          }}
          className="rounded-control text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
          aria-label={openLabel}
        >
          <span className="font-mono text-xs text-brand-primary tabular-nums">
            {line.accountCode}
          </span>
          <span className="ms-2 text-sm text-brand-primary underline-offset-2 hover:underline">
            {line.accountName}
          </span>
        </button>
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
