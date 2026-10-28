'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Download } from 'lucide-react';
import { Button, DateRangePicker, EmptyState, FilterBar, FilterField, Notice, SkeletonTable, StatTile, cn } from '@erp/ui';
import type { VatReport as VatReportData } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { apiClient } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;
const DOCUMENT_HREF = { INVOICE: '/finance/accounting/invoices', CREDIT_NOTE: null, ADJUSTMENT: null } as const;

function currentMonth(now = new Date()) {
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Step 6 — `GET /finance/vat-report?from&to`. */
function getVatReport(from: string, to: string): Promise<VatReportData> {
  return apiClient<VatReportData>(`/finance/vat-report?from=${from}&to=${to}`);
}

/**
 * Step 6 — the VAT report: output VAT for a period, read from the ledger, by rate and by document.
 * Its total is what the VAT account moved by, so it can be filed and tied out in one look. Input
 * VAT on supplier bills is shown for information only: it is not recoverable (ACC-TAX-001).
 */
export function VatReport() {
  const t = useTranslations('finance.vat');
  const [range, setRange] = useState(currentMonth);
  const report = useQuery({ queryKey: ['finance', 'vat', range.from, range.to], queryFn: () => getVatReport(range.from, range.to) });

  const download = (data: VatReportData) =>
    exportCsv(
      reportFilename('vat-report', data.from, data.to),
      [t('colDate'), t('colJournal'), t('colKind'), t('colDocument'), t('colParty'), t('colTaxable'), t('colRate'), t('colVat')],
      data.output.lines.map((l) => [
        l.accountingDate, l.journalNumber, t(`kinds.${l.kind}`), l.documentNumber, l.partyName,
        l.taxableAmount === null ? null : Number(l.taxableAmount), l.rate === null ? null : Number(l.rate), Number(l.vat),
      ]),
    );

  return (
    <div className="space-y-6">
      <ListPageHeader title={t('title')} summary={t('subtitle')} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <FilterBar>
          <FilterField id="vat-range" label={t('period')}>
            <DateRangePicker id="vat-range" fromValue={range.from} toValue={range.to} onChange={(next) => next.from && next.to && setRange({ from: next.from, to: next.to })} />
          </FilterField>
        </FilterBar>
        {report.data && report.data.output.lines.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => download(report.data!)}>
            <Download size={14} aria-hidden="true" /> {t('export')}
          </Button>
        ) : null}
      </div>

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <SkeletonTable rows={5} columns={6} label={t('loading')} />
      ) : (
        <VatBody data={report.data} />
      )}
    </div>
  );
}

function VatBody({ data }: { data: VatReportData }) {
  const t = useTranslations('finance.vat');
  const { output } = data;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatTile label={t('outputTotal')} value={usd(output.total)} note={t('outputNote', { from: formatDate(data.from) ?? data.from, to: formatDate(data.to) ?? data.to })} />
        <StatTile label={t('closingBalance')} value={usd(data.closingBalance)} note={t('closingNote', { date: formatDate(data.to) ?? data.to })} />
        <StatTile label={t('inputTotal')} value={usd(data.input.vat)} note={t('inputNote', { count: data.input.count })} />
      </div>

      {output.lines.length === 0 ? (
        <EmptyState title={t('emptyTitle')} description={t('empty')} />
      ) : (
        <>
          <section className="overflow-x-auto rounded-panel border border-border bg-surface" aria-label={t('summaryTitle')}>
            <table className="w-full min-w-[520px] text-body-sm">
              <caption className="sr-only">{t('summaryTitle')}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('colLine')}</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{t('colTaxable')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('colVat')}</th>
                </tr>
              </thead>
              <tbody>
                {output.byRate.map((r) => (
                  <tr key={r.rate} className="border-b border-border">
                    <th scope="row" className="px-4 py-2 text-start font-normal">{t('atRate', { rate: Number(r.rate) })}</th>
                    <td className="px-3 py-2 text-end tabular-nums">{usd(r.taxable)}</td>
                    <td className="px-4 py-2 text-end tabular-nums">{usd(r.vat)}</td>
                  </tr>
                ))}
                {output.adjustments.count > 0 ? (
                  <tr className="border-b border-border">
                    <th scope="row" className="px-4 py-2 text-start font-normal">{t('adjustments', { count: output.adjustments.count })}</th>
                    <td className="px-3 py-2 text-end text-muted-foreground">—</td>
                    <td className="px-4 py-2 text-end tabular-nums">{usd(output.adjustments.vat)}</td>
                  </tr>
                ) : null}
              </tbody>
              <tfoot>
                <tr className="bg-surface-subtle font-semibold">
                  <th scope="row" className="px-4 py-2 text-start">{t('outputTotal')}</th>
                  <td className="px-3 py-2" />
                  <td className="px-4 py-2 text-end tabular-nums">{usd(output.total)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <section className="overflow-x-auto rounded-panel border border-border bg-surface" aria-label={t('linesTitle')}>
            <table className="w-full min-w-[760px] text-body-sm">
              <caption className="px-4 py-3 text-start text-body font-semibold text-foreground">{t('linesTitle')}</caption>
              <thead>
                <tr className="border-y border-border bg-surface-subtle text-caption text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('colDate')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('colDocument')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('colParty')}</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{t('colTaxable')}</th>
                  <th scope="col" className="px-3 py-2 text-end font-medium">{t('colRate')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('colVat')}</th>
                </tr>
              </thead>
              <tbody>
                {output.lines.map((l, i) => {
                  const href = l.documentId ? DOCUMENT_HREF[l.kind] : null;
                  const label = l.documentNumber ?? l.journalNumber ?? t('noNumber');
                  return (
                    <tr key={`${l.journalEntryId}-${i}`} className="border-b border-border last:border-b-0">
                      <td className="px-4 py-2 tabular-nums">{formatDate(l.accountingDate) ?? l.accountingDate}</td>
                      <td className="px-3 py-2">
                        {href ? <Link href={`${href}/${l.documentId}`} className="font-medium text-brand-primary hover:underline">{label}</Link> : <span className="font-medium">{label}</span>}
                        <span className="block text-caption text-muted-foreground">
                          {t(`kinds.${l.kind}`)}
                          {l.reversal ? ` · ${t('reversal')}` : ''}
                        </span>
                      </td>
                      <td className="px-3 py-2">{l.partyName ?? '—'}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{l.taxableAmount === null ? '—' : usd(l.taxableAmount)}</td>
                      <td className="px-3 py-2 text-end tabular-nums">{l.rate === null ? '—' : `${Number(l.rate)}%`}</td>
                      <td className={cn('px-4 py-2 text-end tabular-nums', Number(l.vat) < 0 && 'text-danger')}>{usd(l.vat)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        </>
      )}

      <Notice tone="info" title={t('inputTitle')}>
        {t('inputBody', { count: data.input.count, taxable: usd(data.input.taxable), vat: usd(data.input.vat) })}
      </Notice>
    </>
  );
}
