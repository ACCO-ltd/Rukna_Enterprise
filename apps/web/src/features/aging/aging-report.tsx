'use client';

import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { CheckCircle2, ChevronDown, ChevronRight, Download, FileText, MessageCircle, Printer, TriangleAlert } from 'lucide-react';
import { Button, CheckboxField, DatePicker, EmptyState, FilterBar, FilterField, Input, SkeletonTable, StatTile, cn } from '@erp/ui';
import type { AgingBucketKey, AgingPartyRow, AgingReport as AgingReportData, AgingSide } from '@erp/types';

import { LoadError } from '@/components/load-error';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { exportCsv, reportFilename } from '@/features/accounting/lib/export-csv';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { StatementWhatsAppDialog } from '@/features/communications/components/statement-whatsapp-dialog';
import { formatDate, formatMoney } from '@/lib/format';

import { getAgingReport } from './api';

const BUCKETS: readonly AgingBucketKey[] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];
const LATE: readonly AgingBucketKey[] = ['d1_30', 'd31_60', 'd61_90', 'd90_plus'];
const DOCUMENT_HREF: Record<AgingSide, string> = {
  receivables: '/finance/accounting/invoices',
  payables: '/finance/accounting/bills',
};

const usd = (amount: string) => formatMoney(amount, 'USD') ?? amount;
const isZero = (amount: string | undefined) => !amount || Number(amount) === 0;
const cents = (v: string) => Math.round(Number(v) * 100);
const sumOf = (values: string[]) => (values.reduce((s, v) => s + cents(v), 0) / 100).toFixed(2);

/**
 * Step 6 / AG — the aging report for one side: what clients owe us, or what we owe suppliers, by
 * party and by days past due. A party row opens to the invoices or bills behind its figures.
 * Receivables can be seen as of any past day (month end, the auditor's date), show what each
 * client holds on account and the net they owe, retention held, and lead straight to chasing:
 * the client's statement, or sending it on WhatsApp. Both sides say whether the total agrees with
 * the control account in the ledger.
 */
export function AgingReport({ side }: { side: AgingSide }) {
  const t = useTranslations('finance.aging');
  const tBucket = useTranslations('finance.home.aging');
  const receivables = side === 'receivables';
  const today = todayWireDate();
  const [asOf, setAsOf] = useState(today);
  const [search, setSearch] = useState('');
  const [lateOnly, setLateOnly] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [sendTo, setSendTo] = useState<AgingPartyRow | null>(null);
  const report = useQuery({
    queryKey: ['finance', 'aging', side, asOf],
    queryFn: () => getAgingReport(side, receivables && asOf !== today ? asOf : undefined),
  });

  const toggle = (id: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const data = report.data;
  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (data?.rows ?? []).filter(
      (r) =>
        (!term || r.partyName.toLowerCase().includes(term) || r.partyCode.toLowerCase().includes(term)) &&
        (!lateOnly || LATE.some((b) => !isZero(r.buckets[b]))),
    );
  }, [data, search, lateOnly]);
  const anyRetention = receivables && rows.some((r) => !isZero(r.retentionHeld));

  const download = (d: AgingReportData) =>
    exportCsv(
      reportFilename(`${side}-aging`, d.asOf),
      [
        t('colParty'),
        t('colCode'),
        ...BUCKETS.map((b) => tBucket(b)),
        t('colTotal'),
        ...(receivables ? [t('colOnAccount'), t('colNet'), t('colRetention')] : []),
      ],
      rows.map((r) => [
        r.partyName,
        r.partyCode,
        ...BUCKETS.map((b) => Number(r.buckets[b])),
        Number(r.total),
        ...(receivables ? [Number(r.onAccount ?? 0), Number(r.netBalance ?? r.total), Number(r.retentionHeld ?? 0)] : []),
      ]),
    );

  const lateTotal = data ? sumOf(LATE.map((b) => data.totals[b])) : '0';
  const share = (amount: string) => (data && Number(data.total) > 0 ? Math.round((Number(amount) / Number(data.total)) * 100) : 0);
  // A small late amount still matters: never round it away to "0%".
  const shareText = (amount: string) =>
    Number(amount) > 0 && share(amount) === 0 ? t('shareUnder1') : t('share', { percent: share(amount) });
  // The usual cause of a gap on a new company: balances carried in from the old system whose
  // opening-balance journal has not been posted. Say so when the gap is exactly them.
  const openingTotal = data ? sumOf(data.rows.flatMap((r) => r.documents.filter((d) => d.opening).map((d) => d.outstanding))) : '0';
  const gapIsOpening = Boolean(data?.ledger && !data.ledger.agrees && cents(data.ledger.difference) === cents(openingTotal) && cents(openingTotal) > 0);

  return (
    <div className="space-y-6">
      <ListPageHeader
        title={t(`${side}.title`)}
        summary={
          data
            ? t(data.historical ? 'summaryAsOf' : 'summary', { total: usd(data.total), date: formatDate(data.asOf) ?? data.asOf })
            : t(`${side}.subtitle`)
        }
        actions={
          data && data.rows.length > 0 ? (
            <div className="flex flex-wrap gap-2 print:hidden">
              <Button variant="outline" size="sm" onClick={() => download(data)}>
                <Download size={14} aria-hidden="true" /> {t('export')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => window.print()}>
                <Printer size={14} aria-hidden="true" /> {t('print')}
              </Button>
            </div>
          ) : null
        }
      />

      <div className="print:hidden">
        <FilterBar>
          <FilterField id="aging-search" label={t('search')} grow>
            <Input id="aging-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t(`${side}.searchPlaceholder`)} />
          </FilterField>
          {receivables ? (
            <FilterField id="aging-as-of" label={t('asOf')}>
              <DatePicker id="aging-as-of" value={asOf} max={today} onChange={(v) => v && setAsOf(v)} />
            </FilterField>
          ) : null}
          <FilterField id="aging-late" label={t('show')}>
            <CheckboxField id="aging-late" label={t('lateOnly')} checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} />
          </FilterField>
        </FilterBar>
      </div>

      {report.isError ? (
        <LoadError message={t('loadFailed')} onRetry={() => void report.refetch()} />
      ) : report.isPending || !data ? (
        <SkeletonTable rows={6} columns={7} label={t('loading')} />
      ) : data.rows.length === 0 ? (
        <EmptyState title={t(`${side}.emptyTitle`)} description={t(`${side}.empty`)} />
      ) : (
        <>
          <div className={cn('grid gap-3 sm:grid-cols-2', receivables ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
            <StatTile label={t(`${side}.tileTotal`)} value={usd(data.total)} />
            <StatTile label={t('tileLate')} value={usd(lateTotal)} note={shareText(lateTotal)} />
            <StatTile label={t('tile90')} value={usd(data.totals.d90_plus)} note={shareText(data.totals.d90_plus)} />
            {receivables ? <StatTile label={t('tileNet')} value={usd(data.netTotal ?? data.total)} note={!isZero(data.onAccount) ? t('lessOnAccount', { amount: usd(data.onAccount!) }) : undefined} /> : null}
          </div>

          {data.ledger ? (
            <p
              className={cn(
                'flex items-start gap-2 rounded-panel border px-4 py-2.5 text-body-sm',
                data.ledger.agrees ? 'border-success/30 bg-success/5 text-foreground' : 'border-warning/40 bg-warning/10 text-foreground',
              )}
            >
              {data.ledger.agrees ? (
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-success" aria-hidden="true" />
              ) : (
                <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" aria-hidden="true" />
              )}
              <span>
                {data.ledger.agrees
                  ? t(`${side}.ledgerAgrees`, { amount: usd(data.ledger.balance) })
                  : t(`${side}.ledgerDiffers`, { amount: usd(data.ledger.balance), difference: usd(data.ledger.difference) })}
                {gapIsOpening ? (
                  <>
                    {' '}
                    {t('gapIsOpening', { amount: usd(openingTotal) })}{' '}
                    <Link href="/finance/accounting/opening-balance" className="font-medium text-brand-primary underline underline-offset-2">
                      {t('openingLink')}
                    </Link>
                  </>
                ) : null}
              </span>
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('noMatches')}</p>
          ) : (
            <div className="relative overflow-x-auto rounded-panel border border-border bg-surface">
              <table className="w-full min-w-[760px] text-body-sm">
                <caption className="sr-only">{t(`${side}.title`)}</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                    <th scope="col" className="px-4 py-2 text-start font-medium">{t(`${side}.party`)}</th>
                    {BUCKETS.map((b) => (
                      <th key={b} scope="col" className="px-3 py-2 text-end font-medium">{tBucket(b)}</th>
                    ))}
                    <th scope="col" className="px-3 py-2 text-end font-medium">{t('colTotal')}</th>
                    {receivables ? (
                      <>
                        <th scope="col" className="px-3 py-2 text-end font-medium">{t('colOnAccount')}</th>
                        <th scope="col" className="px-3 py-2 text-end font-medium">{t('colNet')}</th>
                      </>
                    ) : null}
                    {anyRetention ? <th scope="col" className="px-3 py-2 text-end font-medium">{t('colRetention')}</th> : null}
                    {receivables ? <th scope="col" className="px-3 py-2 print:hidden"><span className="sr-only">{t('colActions')}</span></th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const expanded = open.has(row.partyId);
                    const columns = BUCKETS.length + 2 + (receivables ? 3 : 0) + (anyRetention ? 1 : 0);
                    return (
                      <Fragment key={row.partyId}>
                        <tr className="border-b border-border">
                          <th scope="row" className="px-4 py-2 text-start font-normal">
                            <button
                              type="button"
                              onClick={() => toggle(row.partyId)}
                              aria-expanded={expanded}
                              disabled={row.documents.length === 0}
                              className="inline-flex min-h-9 items-center gap-1.5 text-start font-medium text-foreground hover:underline disabled:no-underline"
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
                                isZero(row.buckets[b]) ? 'text-muted-foreground' : b === 'd90_plus' || b === 'd61_90' ? 'font-semibold text-danger' : 'text-foreground',
                              )}
                            >
                              {isZero(row.buckets[b]) ? '—' : usd(row.buckets[b])}
                            </td>
                          ))}
                          <td className="px-3 py-2 text-end font-semibold tabular-nums">{usd(row.total)}</td>
                          {receivables ? (
                            <>
                              <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">
                                {isZero(row.onAccount) ? '—' : `−${usd(row.onAccount!)}`}
                              </td>
                              <td className="px-3 py-2 text-end font-semibold tabular-nums">{usd(row.netBalance ?? row.total)}</td>
                            </>
                          ) : null}
                          {anyRetention ? (
                            <td className="px-3 py-2 text-end tabular-nums text-muted-foreground">{isZero(row.retentionHeld) ? '—' : usd(row.retentionHeld!)}</td>
                          ) : null}
                          {receivables ? (
                            <td className="px-3 py-1 text-end print:hidden">
                              <span className="inline-flex gap-1">
                                <Button variant="ghost" size="sm" asChild>
                                  <Link
                                    href={`/finance/accounting/statement?clientId=${row.partyId}&from=${data.asOf.slice(0, 4)}-01-01&to=${data.asOf}`}
                                    aria-label={t('statementOf', { name: row.partyName })}
                                  >
                                    <FileText size={14} aria-hidden="true" />
                                    <span className="hidden xl:inline">{t('statement')}</span>
                                  </Link>
                                </Button>
                                <Button variant="ghost" size="sm" onClick={() => setSendTo(row)} aria-label={t('sendStatementTo', { name: row.partyName })}>
                                  <MessageCircle size={14} aria-hidden="true" />
                                </Button>
                              </span>
                            </td>
                          ) : null}
                        </tr>
                        {expanded ? (
                          <tr className="border-b border-border bg-surface-subtle">
                            <td colSpan={columns} className="px-4 py-2">
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
                      <td key={b} className="px-3 py-2 text-end tabular-nums">{usd(sumOf(rows.map((r) => r.buckets[b])))}</td>
                    ))}
                    <td className="px-3 py-2 text-end tabular-nums">{usd(sumOf(rows.map((r) => r.total)))}</td>
                    {receivables ? (
                      <>
                        <td className="px-3 py-2 text-end tabular-nums">−{usd(sumOf(rows.map((r) => r.onAccount ?? '0')))}</td>
                        <td className="px-3 py-2 text-end tabular-nums">{usd(sumOf(rows.map((r) => r.netBalance ?? r.total)))}</td>
                      </>
                    ) : null}
                    {anyRetention ? <td className="px-3 py-2 text-end tabular-nums">{usd(sumOf(rows.map((r) => r.retentionHeld ?? '0')))}</td> : null}
                    {receivables ? <td className="print:hidden" /> : null}
                  </tr>
                  <tr className="text-caption text-muted-foreground">
                    <th scope="row" className="px-4 pb-2 text-start font-normal">{t('shareRow')}</th>
                    {BUCKETS.map((b) => (
                      <td key={b} className="px-3 pb-2 text-end tabular-nums">{share(data.totals[b])}%</td>
                    ))}
                    <td colSpan={1 + (receivables ? 3 : 0) + (anyRetention ? 1 : 0)} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {sendTo ? (
            <StatementWhatsAppDialog
              open
              onClose={() => setSendTo(null)}
              clientId={sendTo.partyId}
              from={`${data.asOf.slice(0, 4)}-01-01`}
              to={data.asOf}
              title={t('whatsappTitle')}
              subtitle={t('whatsappSubtitle', { name: sendTo.partyName, date: formatDate(data.asOf) ?? data.asOf })}
            />
          ) : null}
        </>
      )}
    </div>
  );
}
