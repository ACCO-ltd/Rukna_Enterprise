import type {
  CashflowBucket,
  CashflowBucketSize,
  CashflowCurrencyForecast,
  FinancePortfolioRow,
  FinancePortfolioTotals,
} from '@erp/types';

import type { CsvCell } from '@/features/accounting/lib/export-csv';
import type { XlsxSheet } from '@/lib/xlsx-export';

/**
 * ADR-043 Phase 4 — the Finance exports: the portfolio list and the cash-flow table, serialised
 * from exactly the rows on screen (no second fetch). The same table feeds CSV (`exportCsv`) and
 * XLSX (`downloadXlsx`). Money is written as a number so a spreadsheet can add it; hidden money is
 * an empty cell, never 0. Totals stay one line per currency.
 */

export interface ExportTable {
  headers: string[];
  rows: CsvCell[][];
}

const num = (value: string | null | undefined): number | null =>
  value === null || value === undefined || value === '' ? null : Number(value);

// ─── Portfolio ───────────────────────────────────────────────────────────────────

export interface PortfolioExportLabels {
  headers: {
    code: string;
    project: string;
    status: string;
    client: string;
    currency: string;
    contract: string;
    billed: string;
    collected: string;
    outstanding: string;
    overdue: string;
    cost: string;
    margin: string;
    needsAction: string;
  };
  status: (status: string) => string;
  needsAction: (row: FinancePortfolioRow) => string;
  totalLabel: (currency: string | null) => string;
}

/** The portfolio grid's columns, one row per project, then one totals line per currency. */
export function portfolioExportTable(
  items: FinancePortfolioRow[],
  totals: FinancePortfolioTotals[],
  labels: PortfolioExportLabels,
): ExportTable {
  const h = labels.headers;
  const headers = [
    h.code,
    h.project,
    h.status,
    h.client,
    h.currency,
    h.contract,
    h.billed,
    h.collected,
    h.outstanding,
    h.overdue,
    h.cost,
    h.margin,
    h.needsAction,
  ];
  const rows: CsvCell[][] = items.map((row) => [
    row.code,
    row.name,
    labels.status(row.status),
    row.clientName,
    row.currency,
    num(row.contractValue),
    num(row.billed),
    num(row.collected),
    num(row.outstanding),
    num(row.overdue),
    num(row.costToDate),
    row.margin,
    labels.needsAction(row),
  ]);
  for (const t of totals) {
    rows.push([
      labels.totalLabel(t.currency),
      null,
      null,
      null,
      t.currency,
      num(t.contractValue),
      num(t.billed),
      num(t.collected),
      num(t.outstanding),
      num(t.overdue),
      num(t.costToDate),
      null,
      null,
    ]);
  }
  return { headers, rows };
}

// ─── Cash flow ───────────────────────────────────────────────────────────────────

export interface CashflowExportLabels {
  headers: {
    currency: string;
    period: string;
    fromInvoices: string;
    fromUnbilledStages: string;
    fromOpeningReceivables: string;
    inflows: string;
    fromSupplierBills: string;
    fromOpenCommitments: string;
    fromOpeningPayables: string;
    outflows: string;
    net: string;
    cumulativeNet: string;
  };
  bucket: (bucket: CashflowBucket, size: CashflowBucketSize) => string;
  total: string;
}

function bucketCells(b: Pick<CashflowBucket, 'inflows' | 'outflows' | 'net'> & { cumulativeNet?: string | null }): CsvCell[] {
  return [
    num(b.inflows.fromInvoices),
    num(b.inflows.fromUnbilledStages),
    num(b.inflows.fromOpeningReceivables),
    num(b.inflows.total),
    num(b.outflows.fromSupplierBills),
    num(b.outflows.fromOpenCommitments),
    num(b.outflows.fromOpeningPayables),
    num(b.outflows.total),
    num(b.net),
    num(b.cumulativeNet ?? null),
  ];
}

/** One currency's table: a row per bucket, then the total. */
function cashflowRows(forecast: CashflowCurrencyForecast, size: CashflowBucketSize, labels: CashflowExportLabels): CsvCell[][] {
  return [
    ...forecast.buckets.map((b) => [labels.bucket(b, size), ...bucketCells(b)]),
    [labels.total, ...bucketCells({ ...forecast.totals, cumulativeNet: null })],
  ];
}

function cashflowHeaders(labels: CashflowExportLabels): string[] {
  const h = labels.headers;
  return [
    h.period,
    h.fromInvoices,
    h.fromUnbilledStages,
    h.fromOpeningReceivables,
    h.inflows,
    h.fromSupplierBills,
    h.fromOpenCommitments,
    h.fromOpeningPayables,
    h.outflows,
    h.net,
    h.cumulativeNet,
  ];
}

/** CSV: every currency in one file, a Currency column first — currencies are never added up. */
export function cashflowExportTable(
  currencies: CashflowCurrencyForecast[],
  size: CashflowBucketSize,
  labels: CashflowExportLabels,
): ExportTable {
  return {
    headers: [labels.headers.currency, ...cashflowHeaders(labels)],
    rows: currencies.flatMap((c) => cashflowRows(c, size, labels).map((row) => [c.currency, ...row])),
  };
}

/** XLSX: one sheet per currency. */
export function cashflowExportSheets(
  currencies: CashflowCurrencyForecast[],
  size: CashflowBucketSize,
  labels: CashflowExportLabels,
): XlsxSheet[] {
  return currencies.map((c) => ({ name: c.currency, rows: [cashflowHeaders(labels), ...cashflowRows(c, size, labels)] }));
}
