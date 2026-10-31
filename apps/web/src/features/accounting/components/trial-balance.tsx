'use client';

import { Fragment, useId, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, CheckboxField, DatePicker, EmptyState, FilterBar, FilterField, SkeletonTable, cn } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { LoadError } from '@/components/load-error';
import { formatMoney } from '@/lib/format';

import { CLASS_ORDER } from '../coa-tree';
import { useTrialBalance } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { exportCsv, reportFilename } from '../lib/export-csv';
import { ledgerHref } from '../lib/report-links';
import { AS_OF_PRESETS, asOfDate, type AsOfPreset } from '../statement';
import type { TrialBalanceLine } from '../types';
import { ReportActions } from './report-actions';
import { PresetButtons } from './statement-table';

/**
 * R — every account's balance at a date, debits and credits, grouped by class. The opening balance
 * and the period's movement (the period being the accounting month holding the date) can be shown
 * alongside. Each account opens its ledger up to the date.
 */
export function TrialBalanceReport() {
  const t = useTranslations('accounting.trialBalance');
  const tAsOf = useTranslations('accounting.reportPeriod.asOf');
  const tClass = useTranslations('accounting.chartOfAccounts.classSection');
  const tCommon = useTranslations('accounting.common');
  const tPreset = useTranslations('accounting.reportPeriod');
  const locale = useLocale() as 'en';
  const zeroId = useId();
  const detailId = useId();

  const today = todayWireDate();
  const [preset, setPreset] = useState<AsOfPreset | null>('today');
  const [custom, setCustom] = useState(today);
  const asOf = preset ? asOfDate(preset, today) : custom;
  const [includeZero, setIncludeZero] = useState(false);
  const [detail, setDetail] = useState(false);

  const report = useTrialBalance(asOf, includeZero);
  const usd = (v: string) => (Number(v) === 0 ? '' : (formatMoney(v, 'USD', locale) ?? v));
  const money = (v: string) => formatMoney(v, 'USD', locale) ?? v;

  // Without the movement columns, an account that nets to zero shows nothing; it stays only when asked for.
  const shown = (report.data?.lines ?? []).filter((l) => detail || includeZero || Number(l.closingDebit) !== 0 || Number(l.closingCredit) !== 0);
  const groups = CLASS_ORDER.map((c) => ({ c, lines: shown.filter((l) => l.accountClass === c) })).filter((g) => g.lines.length > 0);
  const other = shown.filter((l) => !CLASS_ORDER.includes(l.accountClass as never));
  if (other.length) groups.push({ c: 'ASSET', lines: other });

  const cols = detail
    ? (['openingDebit', 'openingCredit', 'periodDebit', 'periodCredit', 'closingDebit', 'closingCredit'] as const)
    : (['closingDebit', 'closingCredit'] as const);
  const colLabel: Record<(typeof cols)[number], string> = {
    openingDebit: t('colOpeningDebit'), openingCredit: t('colOpeningCredit'),
    periodDebit: t('colPeriodDebit'), periodCredit: t('colPeriodCredit'),
    closingDebit: detail ? t('colClosingDebit') : t('colDebit'), closingCredit: detail ? t('colClosingCredit') : t('colCredit'),
  };
  const totalKey = {
    openingDebit: 'totalOpeningDebit', openingCredit: 'totalOpeningCredit', periodDebit: 'totalPeriodDebit',
    periodCredit: 'totalPeriodCredit', closingDebit: 'totalClosingDebit', closingCredit: 'totalClosingCredit',
  } as const;

  const handleExport = () => {
    if (!report.data) return;
    exportCsv(
      reportFilename('trial-balance', asOf),
      [t('csvCode'), t('csvName'), t('colOpeningDebit'), t('colOpeningCredit'), t('colPeriodDebit'), t('colPeriodCredit'), t('colClosingDebit'), t('colClosingCredit')],
      report.data.lines.map((l) => [l.accountCode, l.accountName, l.openingDebit, l.openingCredit, l.periodDebit, l.periodCredit, l.closingDebit, l.closingCredit]),
    );
  };

  return (
    <div className="space-y-5">
      <ListPageHeader title={t('title')} actions={<ReportActions onExport={handleExport} exportDisabled={!report.data?.lines.length} />} />

      <FilterBar>
        <FilterField id="tb-date" label={tCommon('asOfDate')}>
          <div className="flex flex-wrap items-center gap-2">
            <PresetButtons label={tPreset('presets')} options={AS_OF_PRESETS} value={preset} onChange={setPreset} labelFor={(p) => tAsOf(p)} />
            <DatePicker
              id="tb-date"
              value={asOf}
              onChange={(value) => {
                setCustom(value);
                setPreset(null);
              }}
            />
          </div>
        </FilterField>
        <div className="flex flex-wrap items-center gap-4 self-end pb-2">
          <CheckboxField id={detailId} label={t('showMovement')} checked={detail} onChange={(e) => setDetail(e.target.checked)} />
          <CheckboxField id={zeroId} label={t('includeZero')} checked={includeZero} onChange={(e) => setIncludeZero(e.target.checked)} />
        </div>
      </FilterBar>

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <SkeletonTable rows={8} columns={3} label={t('title')} />
      ) : report.data.lines.length === 0 ? (
        <EmptyState title={t('empty')} />
      ) : (
        <>
          {report.data.balanced ? null : (
            <Alert
              variant="error"
              messages={[t('notBalancedHint', { debit: money(report.data.totalClosingDebit), credit: money(report.data.totalClosingCredit) })]}
            />
          )}
          <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
            <div className="overflow-x-auto">
              <table className={cn('w-full text-body-sm', detail && 'min-w-[960px]')}>
                <caption className="sr-only">{t('title')}</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                    <th scope="col" className="sticky start-0 bg-surface-subtle px-4 py-2 text-start font-medium">{t('colAccount')}</th>
                    {cols.map((c) => (
                      <th key={c} scope="col" className="whitespace-nowrap px-3 py-2 text-end font-medium last:pe-4">{colLabel[c]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g) => (
                    <Fragment key={g.c}>
                      <tr className="border-b border-border">
                        <th scope="rowgroup" colSpan={cols.length + 1} className="px-4 pb-1 pt-4 text-start text-caption font-semibold uppercase tracking-wide text-muted-foreground">
                          {tClass(g.c)}
                        </th>
                      </tr>
                      {g.lines.map((line: TrialBalanceLine) => (
                        <tr key={line.accountId} className="border-b border-border/60 hover:bg-surface-subtle">
                          <th scope="row" className="sticky start-0 bg-surface px-4 py-2 text-start font-normal">
                            <Link href={ledgerHref(line.accountId, { to: asOf })} className="hover:text-brand-primary hover:underline" aria-label={t('openLedger', { account: line.accountName })}>
                              <span className="me-2 font-mono text-caption text-muted-foreground">{line.accountCode}</span>
                              {line.accountName}
                            </Link>
                          </th>
                          {cols.map((c) => (
                            <td key={c} className="whitespace-nowrap px-3 py-2 text-end tabular-nums last:pe-4">{usd(line[c])}</td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-surface-subtle font-semibold">
                    <th scope="row" className="sticky start-0 bg-surface-subtle px-4 py-2.5 text-start">
                      {t('totals')}
                      <span className={cn('ms-2 text-caption font-medium', report.data.balanced ? 'text-success' : 'text-danger')}>
                        {report.data.balanced ? t('balanced') : t('notBalanced')}
                      </span>
                    </th>
                    {cols.map((c) => (
                      <td key={c} className="whitespace-nowrap px-3 py-2.5 text-end tabular-nums last:pe-4">{money(report.data[totalKey[c]])}</td>
                    ))}
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
