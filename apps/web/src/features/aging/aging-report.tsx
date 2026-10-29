'use client';

import { Fragment, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { Button, EmptyState, SkeletonTable, cn } from '@erp/ui';
import type { AgingBucketKey, AgingReport as AgingReportData, AgingSide } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { formatDate, formatMoney } from '@/lib/format';

import { getAgingReport } from './api';

const BUCKETS: readonly AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
const DOCUMENT_HREF: Record<AgingSide, string> = {
  receivables: '/finance/accounting/invoices',
  payables: '/finance/accounting/bills',
};

const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;
const isZero = (amount: string) => Number(amount) === 0;

/**
 * Step 6 — the aging report for one side: what clients owe us, or what we owe suppliers, by party
 * and by days past due. A party row opens to the invoices or bills behind its figures; each links
 * to the document. The figures are the ones Finance Home shows, by the same rule.
 */
export function AgingReport({ side }: { side: AgingSide }) {
  const t = useTranslations('finance.aging');
  const tBucket = useTranslations('finance.home.aging');
  const report = useQuery({ queryKey: ['finance', 'aging', side], queryFn: () => getAgingReport(side) });
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const download = (data: AgingReportData) =>
    exportCsv(
      reportFilename(`${side}-aging`, data.asOf),
      [t('colParty'), t('colCode'), ...BUCKETS.map((b) => tBucket(b)), t('colTotal')],
      data.rows.map((r) => [r.partyName, r.partyCode, ...BUCKETS.map((b) => Number(r.buckets[b])), Number(r.total)]),
    );

  return (
    <div className="space-y-6">
      <ListPageHeader
        title={t(`${side}.title`)}
        summary={report.data ? t('summary', { total: usd(report.data.total), date: formatDate(report.data.asOf) ?? report.data.asOf }) : t(`${side}.subtitle`)}
        actions={report.data && report.data.rows.length > 0 ? (
          <Button variant="outline" size="sm" onClick={() => download(report.data!)}>
            <Download size={14} aria-hidden="true" /> {t('export')}
          </Button>
        ) : null}
      />

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending ? (
        <SkeletonTable rows={6} columns={7} label={t('loading')} />
      ) : report.data.rows.length === 0 ? (
        <EmptyState title={t(`${side}.emptyTitle`)} description={t(`${side}.empty`)} />
      ) : (
        <div className="overflow-x-auto rounded-panel border border-border bg-surface">
          <table className="w-full min-w-[720px] text-body-sm">
            <caption className="sr-only">{t(`${side}.title`)}</caption>
            <thead>
              <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                <th scope="col" className="px-4 py-2 text-start font-medium">{t(`${side}.party`)}</th>
                {BUCKETS.map((b) => (
                  <th key={b} scope="col" className="px-3 py-2 text-end font-medium">{tBucket(b)}</th>
                ))}
                <th scope="col" className="px-4 py-2 text-end font-medium">{t('colTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {report.data.rows.map((row) => {
                const expanded = open.has(row.partyId);
                return (
                  <Fragment key={row.partyId}>
                    <tr className="border-b border-border">
                      <th scope="row" className="px-4 py-2 text-start font-normal">
                        <button
                          type="button"
                          onClick={() => toggle(row.partyId)}
                          aria-expanded={expanded}
                          className="inline-flex min-h-9 items-center gap-1.5 text-start font-medium text-foreground hover:underline"
                        >
                          {expanded ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronRight size={14} aria-hidden="true" />}
                          <span>{row.partyName}</span>
                          <span className="text-caption font-normal text-muted-foreground">{row.partyCode}</span>
                        </button>
                      </th>
                      {BUCKETS.map((b) => (
                        <td
                          key={b}
                          className={cn(
                            'px-3 py-2 text-end tabular-nums',
                            isZero(row.buckets[b]) ? 'text-muted-foreground' : b === 'd90_plus' ? 'font-semibold text-danger' : 'text-foreground',
                          )}
                        >
                          {isZero(row.buckets[b]) ? '—' : usd(row.buckets[b])}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-end font-semibold tabular-nums">{usd(row.total)}</td>
                    </tr>
                    {expanded ? (
                      <tr className="border-b border-border bg-surface-subtle">
                        <td colSpan={BUCKETS.length + 2} className="px-4 py-2">
                          <ul className="divide-y divide-border" aria-label={t('documentsOf', { name: row.partyName })}>
                            {row.documents.map((d) => (
                              <li key={d.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2">
                                <span className="min-w-0">
                                  <Link href={`${DOCUMENT_HREF[side]}/${d.id}`} className="font-medium text-brand-primary hover:underline">
                                    {d.number ?? t('noNumber')}
                                  </Link>
                                  <span className="text-caption text-muted-foreground">
                                    {' · '}
                                    {t('due', { date: formatDate(d.dueDate) ?? d.dueDate })}
                                    {d.daysLate > 0 ? ` · ${t('daysLate', { count: d.daysLate })}` : ''}
                                    {d.opening ? ` · ${t('opening')}` : ''}
                                  </span>
                                </span>
                                <span className="tabular-nums">{usd(d.outstanding)}</span>
                              </li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-surface-subtle font-semibold">
                <th scope="row" className="px-4 py-2 text-start">{t('colTotal')}</th>
                {BUCKETS.map((b) => (
                  <td key={b} className="px-3 py-2 text-end tabular-nums">{usd(report.data.totals[b])}</td>
                ))}
                <td className="px-4 py-2 text-end tabular-nums">{usd(report.data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
