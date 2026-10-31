'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { SkeletonTable, cn } from '@erp/ui';

import { LoadError } from '@/components/load-error';
import { formatDate, formatMoney } from '@/lib/format';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';

import { useJournalEntries } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { journalHref, sourceDocumentHref, sourceKey } from '../journal-source';

export const BOOK_RANGES = ['month', 'lastMonth', 'quarter', 'year'] as const;
export type BookRange = (typeof BOOK_RANGES)[number];

/** The first and last day of a period, counted back from today. */
export function bookRange(range: BookRange, today: string): { from: string; to: string } {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7));
  const day = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm - 1, dd)).toISOString().slice(0, 10);
  switch (range) {
    case 'month':
      return { from: day(y, m, 1), to: today };
    case 'lastMonth':
      return { from: day(y, m - 1, 1), to: day(y, m, 0) };
    case 'year':
      return { from: day(y, 1, 1), to: today };
    case 'quarter': {
      const d = new Date(`${today}T00:00:00.000Z`);
      d.setUTCDate(d.getUTCDate() - 89);
      return { from: d.toISOString().slice(0, 10), to: today };
    }
  }
}

/**
 * GL-J — the day book: every entry posted in a period, whatever posted it — an invoice, a bill, a
 * receipt, a payment, a transfer, a manual journal. Each opens its journal; the source opens the
 * document behind it.
 */
export function JournalBook() {
  const t = useTranslations('accounting.journalBook');
  const locale = useLocale() as 'en';
  const [range, setRange] = useState<BookRange>('month');
  const [source, setSource] = useState('');
  const { from, to } = bookRange(range, todayWireDate());
  const entries = useJournalEntries(from, to);

  const sources = useMemo(() => [...new Set((entries.data ?? []).map((e) => sourceKey(e.sourceDocumentType)))].sort(), [entries.data]);
  const rows = (entries.data ?? []).filter((e) => !source || sourceKey(e.sourceDocumentType) === source);
  const total = fromMinorUnits(rows.reduce((sum, e) => sum + toMinorUnits(e.totalAmount, 2), 0), 2);
  const usd = (value: string) => formatMoney(value, 'USD', locale) ?? value;

  return (
    <div className="min-w-0 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
        <div role="group" aria-label={t('rangeLabel')} className="inline-flex flex-wrap rounded-control border border-border p-0.5">
          {BOOK_RANGES.map((r) => (
            <button
              key={r}
              type="button"
              aria-pressed={range === r}
              onClick={() => setRange(r)}
              className={cn(
                'min-h-9 rounded-control px-2.5 text-caption font-medium',
                range === r ? 'bg-brand-accent text-brand-primary' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t(`range.${r}`)}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-caption text-muted-foreground">
          {t('filterSource')}
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="min-h-9 rounded-control border border-border bg-surface px-2 text-body-sm text-foreground"
          >
            <option value="">{t('allSources')}</option>
            {sources.map((s) => (
              <option key={s} value={s}>{t(`source.${s}`)}</option>
            ))}
          </select>
        </label>
        <span className="ms-auto text-caption text-muted-foreground">
          {formatDate(from, locale)} – {formatDate(to, locale)}
        </span>
      </div>

      {entries.isError ? (
        <div className="p-4"><LoadError message={t('loadFailed')} onRetry={() => void entries.refetch()} /></div>
      ) : entries.isPending ? (
        <div className="p-4"><SkeletonTable rows={6} columns={5} label={t('loading')} /></div>
      ) : rows.length === 0 ? (
        <p className="px-4 py-10 text-center text-body-sm text-muted-foreground">{t('empty')}</p>
      ) : (
        <>
          <ul className="divide-y divide-border sm:hidden" aria-label={t('title')}>
            {rows.map((e) => (
              <li key={e.id}>
                <Link href={journalHref(e.id)} className="flex items-start justify-between gap-3 px-4 py-3 text-body-sm hover:bg-surface-subtle">
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-foreground">{e.description}</span>
                    <span className="block text-caption text-muted-foreground">
                      {[e.journalNumber, formatDate(e.accountingDate, locale), t(`source.${sourceKey(e.sourceDocumentType)}`)].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="shrink-0 font-medium tabular-nums">{usd(e.totalAmount)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[720px] text-body-sm">
              <caption className="sr-only">{t('title')}</caption>
              <thead>
                <tr className="border-b border-border bg-surface-subtle text-caption text-muted-foreground">
                  <th scope="col" className="px-4 py-2 text-start font-medium">{t('colNumber')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('colDate')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('colSource')}</th>
                  <th scope="col" className="px-3 py-2 text-start font-medium">{t('colDescription')}</th>
                  <th scope="col" className="px-4 py-2 text-end font-medium">{t('colAmount')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const doc = sourceDocumentHref(e.sourceDocumentType, e.sourceDocumentId);
                  const label = t(`source.${sourceKey(e.sourceDocumentType)}`);
                  return (
                    <tr key={e.id} className="border-b border-border last:border-b-0 hover:bg-surface-subtle">
                      <th scope="row" className="px-4 py-2.5 text-start font-normal">
                        <Link href={journalHref(e.id)} className="font-mono font-medium text-brand-primary hover:underline">{e.journalNumber}</Link>
                      </th>
                      <td className="whitespace-nowrap px-3 py-2.5">{formatDate(e.accountingDate, locale)}</td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {doc ? <Link href={doc} className="hover:underline">{label}</Link> : label}
                        {e.reversalOfJournalEntryId ? <span className="ms-1.5 text-caption text-muted-foreground">· {t('reversal')}</span> : null}
                      </td>
                      <td className="max-w-[28rem] truncate px-3 py-2.5">{e.description}</td>
                      <td className="px-4 py-2.5 text-end tabular-nums">{usd(e.totalAmount)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-surface-subtle font-semibold">
                  <th scope="row" colSpan={4} className="px-4 py-2.5 text-start">{t('total', { count: rows.length })}</th>
                  <td className="px-4 py-2.5 text-end tabular-nums">{usd(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
