'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Card, CardHeader, CardTitle, DateRangePicker, EmptyState, FilterBar, FilterField, SkeletonTable } from '@erp/ui';

import { ListPageHeader } from '@/components/layout/list-page-header';
import { LoadError } from '@/components/load-error';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, toMinorUnits } from '@/lib/money';

import { useAccounts, useProfitLoss } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { exportCsv, reportFilename } from '../lib/export-csv';
import { ledgerHref, rangeFromParams } from '../lib/report-links';
import { REPORT_RANGES, figuresOf, reportRange, statementSections, type ReportRange } from '../statement';
import type { ProfitLoss, ProfitLossSection } from '../types';
import { ReportActions } from './report-actions';
import { PresetButtons, StatementTable, type StatementBlock } from './statement-table';

/**
 * R — the profit and loss for a period as one statement: income, cost of sales, gross profit,
 * expenses, net income, sub-accounts under their heading. Year-end closing entries are left out
 * server-side. Each account opens its ledger for the same dates.
 */
export function ProfitLossReport() {
  const t = useTranslations('accounting.profitLoss');
  const tRange = useTranslations('accounting.reportPeriod.range');
  const tClass = useTranslations('accounting.chartOfAccounts.classSection');
  const tCommon = useTranslations('accounting.common');
  const tPreset = useTranslations('accounting.reportPeriod');
  const locale = useLocale() as 'en';
  const router = useRouter();
  const pathname = usePathname() ?? '/finance/accounting/profit-loss';
  const searchParams = useSearchParams();

  const fromUrl = rangeFromParams(searchParams);
  const [preset, setPreset] = useState<ReportRange | null>(() =>
    fromUrl ? (REPORT_RANGES.find((r) => { const x = reportRange(r, todayWireDate()); return x.from === fromUrl.from && x.to === fromUrl.to; }) ?? null) : 'month',
  );
  const [custom, setCustom] = useState(() => fromUrl ?? reportRange('month', todayWireDate()));
  const range = preset ? reportRange(preset, todayWireDate()) : custom;

  const report = useProfitLoss(range.from, range.to);
  const accounts = useAccounts();

  const choose = (next: { from: string; to: string }, p: ReportRange | null) => {
    setPreset(p);
    setCustom(next);
    router.replace(`${pathname}?${new URLSearchParams(next).toString()}`);
  };

  const blocks = useMemo<StatementBlock[]>(() => {
    if (!report.data) return [];
    const d = report.data;
    const [income, cos, expense] = statementSections(
      accounts.data ?? [],
      [figuresOf([...d.revenue.lines, ...d.costOfSales.lines, ...d.expenses.lines])],
      ['INCOME', 'COST_OF_SALES', 'EXPENSE'],
      new Map([...d.revenue.lines, ...d.costOfSales.lines, ...d.expenses.lines].map((l) => [l.accountId, { accountClass: l.accountClass, code: l.accountCode, name: l.accountName }])),
    );
    const minor = (v: string) => toMinorUnits(v, MONEY_SCALE);
    const revenue = minor(d.revenue.total);
    const gross = minor(d.grossProfit);
    const net = minor(d.netIncome);
    const hrefFor = (id: string) => ledgerHref(id, range);
    const out: StatementBlock[] = [
      { kind: 'section', key: 'income', label: tClass('INCOME'), lines: income!.lines, totals: [revenue], totalLabel: t('totalIncome'), hrefFor },
    ];
    if (cos!.lines.length > 0) {
      out.push({ kind: 'section', key: 'cos', label: tClass('COST_OF_SALES'), lines: cos!.lines, totals: [minor(d.costOfSales.total)], totalLabel: t('totalCostOfSales'), hrefFor });
      out.push({
        kind: 'summary', key: 'gross', label: t('grossProfit'), amounts: [gross],
        note: revenue > 0 ? t('grossMarginLabel', { percent: ((gross / revenue) * 100).toFixed(1) }) : undefined,
      });
    }
    out.push({ kind: 'section', key: 'expense', label: tClass('EXPENSE'), lines: expense!.lines, totals: [minor(d.expenses.total)], totalLabel: t('totalExpenses'), hrefFor });
    out.push({ kind: 'summary', key: 'net', label: net < 0 ? t('netLoss') : t('netIncome'), amounts: [net], strong: true });
    return out;
  }, [report.data, accounts.data, range, t, tClass]);

  const hasLines = (report.data?.revenue.lines.length ?? 0) + (report.data?.costOfSales.lines.length ?? 0) + (report.data?.expenses.lines.length ?? 0) > 0;

  return (
    <div className="space-y-5">
      <ListPageHeader
        title={t('title')}
        actions={<ReportActions onExport={() => report.data && exportProfitLoss(report.data, range, t)} exportDisabled={!hasLines} />}
      />

      <FilterBar>
        <FilterField id="pl-range" label={tCommon('dateRange')}>
          <div className="flex flex-wrap items-center gap-2">
            <PresetButtons
              label={tPreset('presets')}
              options={REPORT_RANGES}
              value={preset}
              onChange={(p) => choose(reportRange(p, todayWireDate()), p)}
              labelFor={(p) => tRange(p)}
            />
            <DateRangePicker id="pl-range" fromValue={range.from} toValue={range.to} onChange={(next) => choose(next, null)} />
          </div>
        </FilterField>
      </FilterBar>

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending || accounts.isPending ? (
        <SkeletonTable rows={8} columns={2} label={t('title')} />
      ) : !hasLines ? (
        <EmptyState title={t('empty')} />
      ) : (
        <StatementTable caption={t('title')} columns={[`${formatDate(range.from, locale)} – ${formatDate(range.to, locale)}`]} blocks={blocks} />
      )}
    </div>
  );
}

export function Section({
  section,
  label,
  locale,
  onDrill,
}: {
  section: ProfitLossSection;
  label: string;
  locale: 'en' | 'ar';
  /**
   * When set, each line becomes a drill-down into that account's ledger. Left undefined by the
   * project P&L, which has no standalone ledger to open — the lines stay plain there.
   */
  onDrill?: (accountId: string) => void;
}) {
  const t = useTranslations('accounting.profitLoss');

  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b border-border py-3">
        <CardTitle className="text-sm">{label}</CardTitle>
        <p className="text-sm font-semibold text-foreground">
          <bdi className="tabular-nums">{formatMoney(section.total, undefined, locale)}</bdi>
        </p>
      </CardHeader>

      {section.lines.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted-foreground">{t('sectionEmpty')}</p>
      ) : (
        <ul className="divide-y divide-border">
          {section.lines.map((line) =>
            onDrill ? (
              <li
                key={line.accountId}
                className="cursor-pointer px-4 py-2.5 hover:bg-surface-subtle"
                onClick={() => onDrill(line.accountId)}
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onDrill(line.accountId);
                      }}
                      className="rounded-control text-start focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
                      aria-label={t('openLedger', { account: line.accountName })}
                    >
                      <span className="font-mono text-xs text-brand-primary tabular-nums">
                        {line.accountCode}
                      </span>
                      <span className="ms-2 text-sm text-brand-primary underline-offset-2 hover:underline">
                        {line.accountName}
                      </span>
                    </button>
                  </div>
                  <span className="text-sm text-foreground">
                    <bdi className="tabular-nums">
                      {formatMoney(line.amount, undefined, locale)}
                    </bdi>
                  </span>
                </div>
              </li>
            ) : (
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
            ),
          )}
        </ul>
      )}
    </Card>
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
          ? 'flex flex-wrap items-baseline justify-between gap-3 rounded-panel border-2 border-brand-primary/30 bg-brand-primary/5 px-4 py-4'
          : 'flex flex-wrap items-baseline justify-between gap-3 rounded-panel border border-border bg-muted px-4 py-3'
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

/** Serialises the three sections into one CSV, tagged by section, plus the P&L subtotals. */
function exportProfitLoss(
  data: ProfitLoss,
  range: { from: string; to: string },
  t: ReturnType<typeof useTranslations<'accounting.profitLoss'>>,
): void {
  const sectionRows = (label: string, section: ProfitLossSection) =>
    section.lines.map((line) => [label, line.accountCode, line.accountName, line.amount]);

  const rows: (string | number)[][] = [
    ...sectionRows(t('revenue'), data.revenue),
    ...sectionRows(t('costOfSales'), data.costOfSales),
    // Subtotals carry no account code; the section column names them.
    [t('grossProfit'), '', '', data.grossProfit],
    ...sectionRows(t('expenses'), data.expenses),
    [t('netIncome'), '', '', data.netIncome],
  ];

  exportCsv(
    reportFilename('profit-and-loss', range.from, range.to),
    [t('csvSection'), t('csvCode'), t('csvName'), t('csvAmount')],
    rows,
  );
}
