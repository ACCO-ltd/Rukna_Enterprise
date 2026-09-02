'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  FormField,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';

import { useJournals } from '../hooks/use-accounting';
import { entryTotals } from '../journal-entry';
import type { JournalEntry, JournalStatus } from '../types';
import { JournalStatusBadge } from './journal-status-badge';

const STATUSES: JournalStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'REVERSED',
];

export function JournalsList() {
  const t = useTranslations('accounting.journals');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';

  const journals = useJournals();
  const [status, setStatus] = useState<JournalStatus | ''>('');

  const visible = useMemo(() => {
    const all = journals.data ?? [];
    return status ? all.filter((j) => j.status === status) : all;
  }, [journals.data, status]);

  if (journals.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-lg border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (journals.isError) {
    return <Alert variant="error" messages={[t('loadFailed')]} />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
        </div>
        <Button asChild>
          <Link href="/finance/accounting/journals/new">{t('newJournal')}</Link>
        </Button>
      </div>

      {journals.data.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-foreground">{t('empty')}</p>
          <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
            {t('emptyHint')}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-4">
            <FormField htmlFor="journal-status" label={t('filterByStatus')} className="sm:w-56">
              <Select
                id="journal-status"
                value={status}
                onChange={(value) => setStatus(value as JournalStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </FormField>
            {/* `GET /journals` accepts no query parameters despite §6.17 documenting
                `?status=` (A7), so this filter is applied here. Said plainly, because a
                filter that silently only covers the loaded page is a lie about the data. */}
            <p className="text-xs text-muted-foreground sm:pb-3">{t('clientFilterNote')}</p>
          </div>

          <p className="text-sm text-muted-foreground" aria-live="polite">
            {t('countLabel', { count: visible.length })}
          </p>

          {visible.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
            </div>
          ) : (
            <TableScroll aria-label={t('title')}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('colNumber')}</TableHead>
                    <TableHead>{t('colDate')}</TableHead>
                    <TableHead className="min-w-[200px]">{t('colDescription')}</TableHead>
                    <TableHead>{t('colStatus')}</TableHead>
                    <TableHead numeric>{t('colAmount')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((journal) => (
                    <JournalRow key={journal.id} journal={journal} locale={locale} />
                  ))}
                </TableBody>
              </Table>
            </TableScroll>
          )}
        </>
      )}
    </div>
  );
}

function JournalRow({ journal, locale }: { journal: JournalEntry; locale: 'en' | 'ar' }) {
  const t = useTranslations('accounting.journals');

  // The debit column. On a balanced entry it is the value of the journal; on an unbalanced
  // draft it is one of two figures, and the detail screen is where that gets shown properly.
  const totals = entryTotals(journal);

  return (
    <TableRow>
      <TableCell>
        <Link
          href={`/finance/accounting/journals/${journal.id}`}
          className="font-mono text-sm text-brand-primary underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary"
        >
          {journal.journalNumber ?? t('unnumbered')}
        </Link>
      </TableCell>

      <TableCell>
        <span className="text-sm text-muted-foreground">
          {formatDate(journal.accountingDate, locale)}
        </span>
      </TableCell>

      <TableCell className="min-w-[200px] max-w-[320px]">
        <span className="line-clamp-2 text-sm text-foreground">{journal.description}</span>
      </TableCell>

      <TableCell>
        <JournalStatusBadge status={journal.status} />
      </TableCell>

      <TableCell numeric>
        <bdi className="tabular-nums">
          {formatMoney(
            fromMinorUnits(totals.debitMinor, MONEY_SCALE),
            journal.currencyCode,
            locale,
          )}
        </bdi>
      </TableCell>
    </TableRow>
  );
}
