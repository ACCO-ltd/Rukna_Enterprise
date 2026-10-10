'use client';

import { useId, useState } from 'react';
import { TrendingUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
  CASHFLOW_BUCKET_SIZES,
  CASHFLOW_LINE_TYPES,
  type CashflowBucket,
  type CashflowBucketSize,
  type CashflowCurrencyForecast,
  type CashflowForecastResponse,
} from '@erp/types';
import {
  EmptyState,
  Notice,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
  ViewSwitcher,
  cn,
} from '@erp/ui';

import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { formatMoney } from '@/lib/format';
import { downloadXlsx } from '@/lib/xlsx-export';

import { cashflowExportSheets, cashflowExportTable, type CashflowExportLabels } from '../exports';
import { useCanViewFinanceProjects, useCashflowForecast } from '../hooks';
import { ExportButtons } from './export-buttons';
import { NoFinanceAccess } from './no-finance-access';

const utcDate = (iso: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('en-GB', { ...options, timeZone: 'UTC' }).format(new Date(`${iso}T00:00:00Z`));

/** A bucket's row label: "Overdue / now", "Week of 5 Oct 2026", "Oct 2026", "From 1 Apr 2027", "Undated". */
export function useBucketLabel() {
  const t = useTranslations('finance.cashflow.bucket');
  return (bucket: CashflowBucket, size: CashflowBucketSize): string => {
    switch (bucket.kind) {
      case 'NOW':
        return t('now');
      case 'UNDATED':
        return t('undated');
      case 'LATER':
        return t('later', { date: utcDate(bucket.start!, { day: 'numeric', month: 'short', year: 'numeric' }) });
      case 'PERIOD':
        return size === 'MONTH'
          ? utcDate(bucket.start!, { month: 'short', year: 'numeric' })
          : t('week', { date: utcDate(bucket.start!, { day: 'numeric', month: 'short', year: 'numeric' }) });
    }
  };
}

/**
 * ADR-043 Phase 4 — the cash-flow forecast: money expected in (issued invoices, stages not yet
 * invoiced) and out (supplier bills, open purchase orders), by week or month, per currency. Every
 * figure comes from `GET /finance/cashflow`; nothing is computed here but labels. Used for the
 * portfolio (Finance → Reports → Cash flow) and one project (the project's Cash flow tab).
 */
export function CashflowView({ projectId, projectCode }: { projectId?: string; projectCode?: string }) {
  const t = useTranslations('finance.cashflow');
  const allowed = useCanViewFinanceProjects();
  const [size, setSize] = useState<CashflowBucketSize>('WEEK');
  const [currency, setCurrency] = useState<string | null>(null);
  const forecast = useCashflowForecast({ projectId, bucket: size }, { enabled: allowed });
  const bucketLabel = useBucketLabel();

  if (!allowed) return <NoFinanceAccess />;

  const data = forecast.data;
  const current = data?.currencies.find((c) => c.currency === currency) ?? data?.currencies[0] ?? null;

  const exportLabels: CashflowExportLabels = {
    headers: {
      currency: t('col.currency'),
      period: t('col.period'),
      fromInvoices: t('line.fromInvoices'),
      fromUnbilledStages: t('line.fromUnbilledStages'),
      fromOpeningReceivables: t('line.fromOpeningReceivables'),
      inflows: t('col.inflows'),
      fromSupplierBills: t('line.fromSupplierBills'),
      fromOpenCommitments: t('line.fromOpenCommitments'),
      fromOpeningPayables: t('line.fromOpeningPayables'),
      outflows: t('col.outflows'),
      net: t('col.net'),
      cumulativeNet: t('col.cumulative'),
    },
    bucket: bucketLabel,
    total: t('total'),
  };
  const filename = reportFilename('cash-flow', projectCode, size.toLowerCase(), data?.from);
  const canExport = !!data && data.moneyVisible && data.currencies.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <ViewSwitcher
            aria-label={t('bucketLabel')}
            value={size}
            onValueChange={(v) => setSize(v as CashflowBucketSize)}
            items={CASHFLOW_BUCKET_SIZES.map((s) => ({ value: s, label: t(`size.${s}`) }))}
          />
          {data && data.currencies.length > 1 ? (
            <ViewSwitcher
              aria-label={t('currencyLabel')}
              value={current?.currency ?? ''}
              onValueChange={setCurrency}
              items={data.currencies.map((c) => ({ value: c.currency, label: c.currency }))}
            />
          ) : null}
        </div>
        <ExportButtons
          disabled={!canExport}
          onCsv={() => {
            const table = cashflowExportTable(data!.currencies, size, exportLabels);
            exportCsv(filename, table.headers, table.rows);
          }}
          onXlsx={() => downloadXlsx(filename, cashflowExportSheets(data!.currencies, size, exportLabels))}
        />
      </div>

      {forecast.isPending ? (
        <div role="status" aria-live="polite" className="space-y-3">
          <span className="sr-only">{t('loading')}</span>
          <Skeleton className="h-56 w-full rounded-panel" aria-hidden="true" />
          <Skeleton className="h-64 w-full rounded-panel" aria-hidden="true" />
        </div>
      ) : forecast.isError ? (
        <Notice tone="danger" title={t('loadFailed')} />
      ) : !current ? (
        <EmptyState icon={<TrendingUp size={20} aria-hidden="true" />} title={t('empty')} description={t('emptyHint')} />
      ) : !data!.moneyVisible ? (
        <Notice tone="info" title={t('hidden')} />
      ) : (
        <>
          <p className="text-body-sm text-muted-foreground">
            {t('range', {
              from: utcDate(data!.from, { day: 'numeric', month: 'short', year: 'numeric' }),
              to: utcDate(data!.to, { day: 'numeric', month: 'short', year: 'numeric' }),
              currency: current.currency,
            })}
          </p>
          <CashflowChart forecast={current} size={size} />
          <CashflowTable forecast={current} size={size} bucketLabel={bucketLabel} />
        </>
      )}

      {data ? <Assumptions data={data} /> : null}
    </div>
  );
}

function CashflowTable({
  forecast,
  size,
  bucketLabel,
}: {
  forecast: CashflowCurrencyForecast;
  size: CashflowBucketSize;
  bucketLabel: (b: CashflowBucket, s: CashflowBucketSize) => string;
}) {
  const t = useTranslations('finance.cashflow');
  const money = (value: string | null, signed = false) => {
    const text = formatMoney(value, forecast.currency) ?? '—';
    return <span className={cn(signed && value !== null && Number(value) < 0 && 'text-danger')}>{text}</span>;
  };
  const cells = (b: Pick<CashflowBucket, 'inflows' | 'outflows' | 'net'>, cumulative: string | null) => (
    <>
      <TableCell numeric>{money(b.inflows.fromInvoices)}</TableCell>
      <TableCell numeric>{money(b.inflows.fromUnbilledStages)}</TableCell>
      <TableCell numeric>{money(b.inflows.fromOpeningReceivables)}</TableCell>
      <TableCell numeric className="font-medium">{money(b.inflows.total)}</TableCell>
      <TableCell numeric>{money(b.outflows.fromSupplierBills)}</TableCell>
      <TableCell numeric>{money(b.outflows.fromOpenCommitments)}</TableCell>
      <TableCell numeric>{money(b.outflows.fromOpeningPayables)}</TableCell>
      <TableCell numeric className="font-medium">{money(b.outflows.total)}</TableCell>
      <TableCell numeric className="font-medium">{money(b.net, true)}</TableCell>
      <TableCell numeric>{cumulative === null ? '—' : money(cumulative, true)}</TableCell>
    </>
  );

  return (
    <TableScroll aria-label={t('tableLabel', { currency: forecast.currency })}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead rowSpan={2}>{t('col.period')}</TableHead>
            <TableHead colSpan={4} className="text-center">{t('col.inflows')}</TableHead>
            <TableHead colSpan={4} className="text-center">{t('col.outflows')}</TableHead>
            <TableHead rowSpan={2} numeric>{t('col.net')}</TableHead>
            <TableHead rowSpan={2} numeric>{t('col.cumulative')}</TableHead>
          </TableRow>
          <TableRow>
            <TableHead numeric>{t('line.fromInvoices')}</TableHead>
            <TableHead numeric>{t('line.fromUnbilledStages')}</TableHead>
            <TableHead numeric>{t('line.fromOpeningReceivables')}</TableHead>
            <TableHead numeric>{t('col.total')}</TableHead>
            <TableHead numeric>{t('line.fromSupplierBills')}</TableHead>
            <TableHead numeric>{t('line.fromOpenCommitments')}</TableHead>
            <TableHead numeric>{t('line.fromOpeningPayables')}</TableHead>
            <TableHead numeric>{t('col.total')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {forecast.buckets.map((b) => (
            <TableRow key={b.key}>
              <TableCell className={cn('whitespace-nowrap', b.kind !== 'PERIOD' && 'font-medium')}>
                {bucketLabel(b, size)}
              </TableCell>
              {cells(b, b.cumulativeNet)}
            </TableRow>
          ))}
          <TableRow className="border-t-2 border-border font-semibold">
            <TableCell>{t('total')}</TableCell>
            {cells(forecast.totals, null)}
          </TableRow>
        </TableBody>
      </Table>
    </TableScroll>
  );
}

const VIEW_W = 720;
const VIEW_H = 220;
const PAD_LEFT = 60;
const PAD_RIGHT = 8;
const PAD_TOP = 10;
const PAD_BOTTOM = 30;

function axisMoney(value: number): string {
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '';
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)}K`;
  return `${sign}${Math.round(abs)}`;
}

/**
 * Inflows and outflows per bucket as paired bars, cumulative net as a line. Secondary to the table
 * (which holds the figures); `role="img"` with a text summary. Undated amounts have no place on a
 * time axis and are left to the table.
 */
function CashflowChart({ forecast, size }: { forecast: CashflowCurrencyForecast; size: CashflowBucketSize }) {
  const t = useTranslations('finance.cashflow');
  const titleId = useId();
  const buckets = forecast.buckets.filter((b) => b.kind !== 'UNDATED');
  const n = (v: string | null) => (v === null ? 0 : Number(v));
  const values = buckets.flatMap((b) => [n(b.inflows.total), n(b.outflows.total), n(b.cumulativeNet)]);
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const plotH = VIEW_H - PAD_TOP - PAD_BOTTOM;
  const plotW = VIEW_W - PAD_LEFT - PAD_RIGHT;
  const y = (v: number) => PAD_TOP + ((max - v) / (max - min)) * plotH;
  const band = plotW / Math.max(buckets.length, 1);
  const bar = Math.max(Math.min(14, (band - 6) / 2), 2);
  const labelEvery = Math.ceil(buckets.length / 8);
  const line = buckets
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${PAD_LEFT + i * band + band / 2},${y(n(b.cumulativeNet))}`)
    .join(' ');

  return (
    <div className="rounded-panel border border-border p-3">
      <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} width="100%" role="img" aria-labelledby={titleId} className="block">
        <title id={titleId}>
          {t('chartSummary', {
            currency: forecast.currency,
            inflows: formatMoney(forecast.totals.inflows.total, forecast.currency) ?? '—',
            outflows: formatMoney(forecast.totals.outflows.total, forecast.currency) ?? '—',
          })}
        </title>
        {[max, (max + min) / 2, min].map((v, i) => (
          <g key={i} aria-hidden="true">
            <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={y(v)} y2={y(v)} stroke="var(--color-border)" strokeWidth={1} />
            <text x={PAD_LEFT - 8} y={y(v) + 4} textAnchor="end" fontSize={11} fill="var(--color-muted-foreground)">
              {axisMoney(v)}
            </text>
          </g>
        ))}
        {min < 0 ? (
          <line x1={PAD_LEFT} x2={VIEW_W - PAD_RIGHT} y1={y(0)} y2={y(0)} stroke="var(--color-muted-foreground)" strokeWidth={1} aria-hidden="true" />
        ) : null}
        {buckets.map((b, i) => {
          const centre = PAD_LEFT + i * band + band / 2;
          const inflow = n(b.inflows.total);
          const outflow = n(b.outflows.total);
          return (
            <g key={b.key} aria-hidden="true">
              <rect x={centre - bar} y={y(inflow)} width={bar - 1} height={Math.max(0, y(0) - y(inflow))} rx={2} fill="var(--color-chart-5)" />
              <rect x={centre} y={y(outflow)} width={bar - 1} height={Math.max(0, y(0) - y(outflow))} rx={2} fill="var(--color-chart-4)" />
              {i % labelEvery === 0 ? (
                <text x={centre} y={VIEW_H - 10} textAnchor="middle" fontSize={10} fill="var(--color-muted-foreground)">
                  {b.kind === 'PERIOD'
                    ? utcDate(b.start!, size === 'MONTH' ? { month: 'short' } : { day: 'numeric', month: 'short' })
                    : t(b.kind === 'NOW' ? 'bucket.nowShort' : 'bucket.laterShort')}
                </text>
              ) : null}
            </g>
          );
        })}
        <path d={line} fill="none" stroke="var(--color-chart-1)" strokeWidth={2} aria-hidden="true" />
      </svg>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        {[
          // In and out are different things — two hues (teal / violet), as on the project dashboard;
          // the running net is the ink-blue line over them.
          { key: 'inflows', color: 'var(--color-chart-5)' },
          { key: 'outflows', color: 'var(--color-chart-4)' },
          { key: 'cumulative', color: 'var(--color-chart-1)' },
        ].map((s) => (
          <li key={s.key} className="flex items-center gap-1.5 text-caption text-muted-foreground">
            <span className="size-2.5 rounded-xs" style={{ background: s.color }} aria-hidden="true" />
            {t(`col.${s.key}`)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The plain-words assumptions behind each line, from the API's `basis`, and what is left out. */
function Assumptions({ data }: { data: CashflowForecastResponse }) {
  const t = useTranslations('finance.cashflow');
  return (
    <details className="rounded-panel border border-border p-3 text-body-sm">
      <summary className="cursor-pointer font-medium text-foreground">{t('assumptions')}</summary>
      <dl className="mt-3 space-y-2">
        {CASHFLOW_LINE_TYPES.map((line) => (
          <div key={line}>
            <dt className="font-medium text-foreground">{t(`line.${line}`)}</dt>
            <dd className="text-muted-foreground">{data.basis[line]}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 font-medium text-foreground">{t('notIncluded')}</p>
      <ul className="mt-1 list-disc space-y-1 ps-5 text-muted-foreground">
        {data.exclusions.map((text) => (
          <li key={text}>{text}</li>
        ))}
      </ul>
    </details>
  );
}
