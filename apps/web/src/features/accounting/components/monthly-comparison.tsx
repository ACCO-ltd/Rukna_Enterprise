'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState, FilterBar, FilterField, Select, SkeletonTable } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { LoadError } from '@/components/load-error';
import { MONEY_SCALE, fromMinorUnits, toMinorUnits } from '@/lib/money';

import { useAccounts, useFiscalYears, useMonthlyPL } from '../hooks/use-accounting';
import { exportCsv, reportFilename } from '../lib/export-csv';
import { ledgerHref } from '../lib/report-links';
import { figuresOf, statementSections } from '../statement';
import type { MonthlyPLColumn } from '../types';
import { ReportActions } from './report-actions';
import { StatementTable, type StatementBlock } from './statement-table';

/**
 * R — the profit and loss month by month across a fiscal year: every account down the side, the
 * months across, the year in the last column. Each account opens its ledger for the year.
 */
export function MonthlyComparisonReport() {
  const t = useTranslations('accounting.monthlyPL');
  const tPl = useTranslations('accounting.profitLoss');
  const tClass = useTranslations('accounting.chartOfAccounts.classSection');
  const locale = useLocale() as 'en';

  const years = useFiscalYears();
  const accounts = useAccounts();
  const [chosenId, setChosenId] = useState('');
  const fiscalYearId = chosenId || years.data?.[0]?.id || '';
  const year = (years.data ?? []).find((y) => y.id === fiscalYearId);
  const report = useMonthlyPL(fiscalYearId);
  const columns: MonthlyPLColumn[] = report.data?.columns ?? [];

  const monthLabel = (c: MonthlyPLColumn) => {
    const p = year?.periods?.find((x) => x.periodNumber === c.periodNumber);
    return p ? new Date(`${p.startDate.slice(0, 10)}T00:00:00Z`).toLocaleString(locale, { month: 'short', timeZone: 'UTC' }) : c.periodName;
  };

  const blocks: StatementBlock[] = (() => {
    if (columns.length === 0) return [];
    const perMonth = columns.map((c) => figuresOf(c.lines ?? []));
    // The year column: each account summed across the months.
    const yearFigures = new Map<string, string>();
    for (const m of perMonth) for (const [id, v] of m) yearFigures.set(id, fromMinorUnits(toMinorUnits(yearFigures.get(id) ?? '0', MONEY_SCALE) + toMinorUnits(v, MONEY_SCALE), MONEY_SCALE));
    const classOf = new Map(columns.flatMap((c) => (c.lines ?? []).map((l) => [l.accountId, { accountClass: l.accountClass, code: l.accountCode, name: l.accountName }] as const)));
    const [income, cos, expense] = statementSections(accounts.data ?? [], [...perMonth, yearFigures], ['INCOME', 'COST_OF_SALES', 'EXPENSE'], classOf);
    const sum = (key: keyof MonthlyPLColumn) => {
      const months = columns.map((c) => toMinorUnits(String(c[key]), MONEY_SCALE));
      return [...months, months.reduce((a, b) => a + b, 0)];
    };
    const range = year ? { from: year.startDate.slice(0, 10), to: year.endDate.slice(0, 10) } : {};
    const hrefFor = (id: string) => ledgerHref(id, range);
    const out: StatementBlock[] = [{ kind: 'section', key: 'income', label: tClass('INCOME'), lines: income!.lines, totals: sum('revenue'), totalLabel: tPl('totalIncome'), hrefFor }];
    if (cos!.lines.length > 0) {
      out.push({ kind: 'section', key: 'cos', label: tClass('COST_OF_SALES'), lines: cos!.lines, totals: sum('costOfSales'), totalLabel: tPl('totalCostOfSales'), hrefFor });
      out.push({ kind: 'summary', key: 'gross', label: tPl('grossProfit'), amounts: sum('grossProfit') });
    }
    out.push({ kind: 'section', key: 'expense', label: tClass('EXPENSE'), lines: expense!.lines, totals: sum('expenses'), totalLabel: tPl('totalExpenses'), hrefFor });
    out.push({ kind: 'summary', key: 'net', label: tPl('netIncome'), amounts: sum('netIncome'), strong: true });
    return out;
  })();

  const posted = columns.some((c) => (c.lines ?? []).length > 0);

  const handleExport = () => {
    if (!posted) return;
    const ids = new Map<string, { code: string; name: string }>();
    for (const c of columns) for (const l of c.lines ?? []) ids.set(l.accountId, { code: l.accountCode, name: l.accountName });
    exportCsv(
      reportFilename('monthly-comparison', year?.name),
      [t('csvCode'), t('csvName'), ...columns.map((c) => c.periodName)],
      [...ids].map(([id, a]) => [a.code, a.name, ...columns.map((c) => c.lines?.find((l) => l.accountId === id)?.amount ?? '0.00')]),
    );
  };

  return (
    <div className="space-y-5">
      <ListPageHeader title={t('title')} actions={<ReportActions onExport={handleExport} exportDisabled={!posted} />} />

      {years.isPending ? (
        <SkeletonTable rows={8} columns={6} label={t('title')} />
      ) : years.data?.length === 0 ? (
        <EmptyState title={t('noFiscalYears')} />
      ) : (
        <>
          <FilterBar>
            <FilterField id="mpl-year" label={t('fiscalYearLabel')}>
              <Select id="mpl-year" value={fiscalYearId} onChange={(value) => setChosenId(value)}>
                {(years.data ?? []).map((y) => (
                  <option key={y.id} value={y.id}>{y.name}</option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>

          {report.isError ? (
            <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
          ) : report.isPending || accounts.isPending ? (
            <SkeletonTable rows={8} columns={6} label={t('title')} />
          ) : !posted ? (
            <EmptyState title={t('empty')} />
          ) : (
            <StatementTable caption={t('title')} columns={[...columns.map(monthLabel), t('total')]} blocks={blocks} />
          )}
        </>
      )}
    </div>
  );
}
