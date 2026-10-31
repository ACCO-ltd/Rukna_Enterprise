'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, DatePicker, EmptyState, FilterBar, FilterField, SkeletonTable } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { LoadError } from '@/components/load-error';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

import { useAccounts, useBalanceSheet } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { exportCsv, reportFilename } from '../lib/export-csv';
import { ledgerHref } from '../lib/report-links';
import { AS_OF_PRESETS, asOfDate, figuresOf, statementSections, type AsOfPreset, type StatementLine } from '../statement';
import type { BalanceSheet, BalanceSheetSection } from '../types';
import { ReportActions } from './report-actions';
import { PresetButtons, StatementTable, type StatementBlock } from './statement-table';

const COMPARE = ['none', 'endLastMonth', 'endLastYear'] as const;
type Compare = (typeof COMPARE)[number];

/** Equity lines the server works out (this year's net income, earlier years not yet closed) — not accounts. */
const SYNTHETIC = new Set(['CURRENT_YEAR_EARNINGS', 'PRIOR_YEAR_EARNINGS']);

/**
 * R — the balance sheet at a date as one statement: assets, liabilities, equity, sub-accounts under
 * their heading, with an optional comparison column. Earnings not yet closed into retained earnings
 * show as their own equity lines. Each account opens its ledger up to the date.
 */
export function BalanceSheetReport() {
  const t = useTranslations('accounting.balanceSheet');
  const tAsOf = useTranslations('accounting.reportPeriod.asOf');
  const tCompare = useTranslations('accounting.reportPeriod.compare');
  const tClass = useTranslations('accounting.chartOfAccounts.classSection');
  const tCommon = useTranslations('accounting.common');
  const tPreset = useTranslations('accounting.reportPeriod');
  const locale = useLocale() as 'en';

  const today = todayWireDate();
  const [preset, setPreset] = useState<AsOfPreset | null>('today');
  const [custom, setCustom] = useState(today);
  const asOf = preset ? asOfDate(preset, today) : custom;
  const [compare, setCompare] = useState<Compare>('none');
  const comparativeDate = compare === 'none' ? undefined : asOfDate(compare, asOf);

  const report = useBalanceSheet(asOf, comparativeDate);
  const accounts = useAccounts();
  const comparing = Boolean(comparativeDate && report.data?.comparativeDate);

  const blocks = useMemo<StatementBlock[]>(() => {
    if (!report.data) return [];
    const d = report.data;
    const all = [...d.assets.lines, ...d.liabilities.lines, ...d.equity.lines].filter((l) => !SYNTHETIC.has(l.accountId));
    const columns = [figuresOf(all)];
    if (comparing) columns.push(new Map(all.map((l) => [l.accountId, l.comparativeBalance ?? '0'])));
    type Fallback = { accountClass: 'ASSET' | 'LIABILITY' | 'EQUITY'; code: string; name: string };
    const where = new Map<string, Fallback>([
      ...d.assets.lines.map((l) => [l.accountId, { accountClass: 'ASSET', code: l.accountCode, name: l.accountName }] as [string, Fallback]),
      ...d.liabilities.lines.map((l) => [l.accountId, { accountClass: 'LIABILITY', code: l.accountCode, name: l.accountName }] as [string, Fallback]),
      ...d.equity.lines.map((l) => [l.accountId, { accountClass: 'EQUITY', code: l.accountCode, name: l.accountName }] as [string, Fallback]),
    ]);
    const [assets, liabilities, equity] = statementSections(accounts.data ?? [], columns, ['ASSET', 'LIABILITY', 'EQUITY'], where);
    const minor = (v: string | undefined) => toMinorUnits(v ?? '0', MONEY_SCALE);
    const totals = (s: BalanceSheetSection) => (comparing ? [minor(s.total), minor(s.comparativeTotal)] : [minor(s.total)]);
    const earnings: StatementLine[] = d.equity.lines
      .filter((l) => SYNTHETIC.has(l.accountId))
      .map((l) => ({
        accountId: l.accountId,
        code: '',
        name: l.accountId === 'CURRENT_YEAR_EARNINGS' ? t('netIncomeThisYear') : t('earlierYearsNotClosed'),
        depth: 0,
        heading: false,
        amounts: comparing ? [minor(l.balance), minor(l.comparativeBalance)] : [minor(l.balance)],
      }));
    const hrefFor = (id: string) => ledgerHref(id, { to: asOf });
    return [
      { kind: 'section', key: 'assets', label: tClass('ASSET'), lines: assets!.lines, totals: totals(d.assets), totalLabel: t('totalAssets'), hrefFor },
      { kind: 'section', key: 'liabilities', label: tClass('LIABILITY'), lines: liabilities!.lines, totals: totals(d.liabilities), totalLabel: t('totalLiabilities'), hrefFor },
      { kind: 'section', key: 'equity', label: tClass('EQUITY'), lines: [...equity!.lines, ...earnings], totals: totals(d.equity), totalLabel: t('totalEquity'), hrefFor: (id) => (SYNTHETIC.has(id) ? '' : hrefFor(id)) },
      {
        kind: 'summary', key: 'le', label: t('totalLiabilitiesAndEquity'), strong: true,
        amounts: comparing ? [minor(d.totalLiabilitiesAndEquity), minor(d.comparativeTotalLiabilitiesAndEquity)] : [minor(d.totalLiabilitiesAndEquity)],
      },
    ];
  }, [report.data, accounts.data, comparing, asOf, t, tClass]);

  const hasLines = (report.data?.assets.lines.length ?? 0) + (report.data?.liabilities.lines.length ?? 0) + (report.data?.equity.lines.length ?? 0) > 0;
  const columnLabels = [formatDate(asOf, locale) ?? asOf, ...(comparing && comparativeDate ? [formatDate(comparativeDate, locale) ?? comparativeDate] : [])];

  return (
    <div className="space-y-5">
      <ListPageHeader
        title={t('title')}
        actions={<ReportActions onExport={() => report.data && exportBalanceSheet(report.data, asOf, comparing, t)} exportDisabled={!hasLines} />}
      />

      <FilterBar>
        <FilterField id="bs-date" label={tCommon('asOfDate')}>
          <div className="flex flex-wrap items-center gap-2">
            <PresetButtons label={tPreset('presets')} options={AS_OF_PRESETS} value={preset} onChange={setPreset} labelFor={(p) => tAsOf(p)} />
            <DatePicker
              id="bs-date"
              value={asOf}
              onChange={(value) => {
                setCustom(value);
                setPreset(null);
              }}
            />
          </div>
        </FilterField>
        <FilterField id="bs-compare" label={t('comparativeLabel')}>
          <PresetButtons label={t('comparativeLabel')} options={COMPARE} value={compare} onChange={setCompare} labelFor={(c) => tCompare(c)} />
        </FilterField>
      </FilterBar>

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending || accounts.isPending ? (
        <SkeletonTable rows={8} columns={2} label={t('title')} />
      ) : !hasLines ? (
        <EmptyState title={t('empty')} />
      ) : (
        <>
          {report.data.balanced ? null : (
            <Alert
              variant="error"
              messages={[
                t('notBalancedHint', {
                  assets: formatMoney(report.data.assets.total, 'USD', locale) ?? report.data.assets.total,
                  liabilitiesAndEquity: formatMoney(report.data.totalLiabilitiesAndEquity, 'USD', locale) ?? report.data.totalLiabilitiesAndEquity,
                }),
              ]}
            />
          )}
          <StatementTable caption={t('title')} columns={columnLabels} blocks={blocks} />
        </>
      )}
    </div>
  );
}

/** The three sections in one CSV, tagged by section, with the comparison when shown. */
function exportBalanceSheet(
  data: BalanceSheet,
  asOf: string,
  comparing: boolean,
  t: ReturnType<typeof useTranslations<'accounting.balanceSheet'>>,
): void {
  const headers = [t('csvSection'), t('csvCode'), t('csvName'), t('csvBalance')];
  if (comparing) headers.push(t('csvComparative'));
  const rows = (label: string, section: BalanceSheetSection) =>
    section.lines.map((line) => {
      const name = line.accountId === 'CURRENT_YEAR_EARNINGS' ? t('netIncomeThisYear') : line.accountId === 'PRIOR_YEAR_EARNINGS' ? t('earlierYearsNotClosed') : line.accountName;
      const row: string[] = [label, SYNTHETIC.has(line.accountId) ? '' : line.accountCode, name, line.balance];
      if (comparing) row.push(line.comparativeBalance ?? '');
      return row;
    });
  exportCsv(reportFilename('balance-sheet', asOf), headers, [
    ...rows(t('assets'), data.assets),
    ...rows(t('liabilities'), data.liabilities),
    ...rows(t('equity'), data.equity),
  ]);
}
