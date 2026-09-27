'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, FilterBar, FilterField, Select } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
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

  const journals = useJournals();
  const [status, setStatus] = useState<JournalStatus | ''>('');

  const visible = useMemo(() => {
    const all = journals.data ?? [];
    return status ? all.filter((j) => j.status === status) : all;
  }, [journals.data, status]);

  const columns: GridColumn<JournalEntry>[] = [
    {
      key: 'number',
      header: t('colNumber'),
      sticky: true,
      sortable: true,
      plainValue: (journal) => journal.journalNumber ?? '',
      render: (journal) => (
        <span className="font-mono text-caption font-semibold">
          {journal.journalNumber ?? t('unnumbered')}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('colDate'),
      sortable: true,
      plainValue: (journal) => journal.accountingDate,
      render: (journal, ctx) => (
        <span className="text-muted-foreground">
          {formatDate(journal.accountingDate, ctx.locale)}
        </span>
      ),
    },
    {
      key: 'description',
      header: t('colDescription'),
      sortable: true,
      plainValue: (journal) => journal.description,
      render: (journal) => (
        <span className="block max-w-[18rem] truncate">{journal.description}</span>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      render: (journal) => <JournalStatusBadge status={journal.status} />,
    },
    {
      key: 'amount',
      header: t('colAmount'),
      numeric: true,
      sortable: true,
      plainValue: (journal) => Number(fromMinorUnits(entryTotals(journal).debitMinor, MONEY_SCALE)),
      render: (journal, ctx) => (
        <bdi className="tabular-nums">
          {formatMoney(
            fromMinorUnits(entryTotals(journal).debitMinor, MONEY_SCALE),
            journal.currencyCode,
            ctx.locale,
          )}
        </bdi>
      ),
    },
  ];

  const createAction = (
    <Button asChild>
      <Link href="/finance/accounting/journals/new">{t('newJournal')}</Link>
    </Button>
  );

  return (
    <div className="space-y-6">

      {/* `GET /journals` accepts no query parameters despite §6.17 documenting `?status=`
          (A7), so this filter is applied here. Said plainly, because a filter that silently
          only covers the loaded page is a lie about the data. */}
      <p className="text-xs text-muted-foreground">{t('clientFilterNote')}</p>

      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(journal) => journal.id}
        label={t('title')}
        isLoading={journals.isPending}
        isError={journals.isError}
        errorMessage={t('loadFailed')}
        rowHref={(journal) => `/finance/accounting/journals/${journal.id}`}
        emptyState={
          (journals.data?.length ?? 0) === 0 ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mx-auto mt-1 max-w-prose text-sm text-muted-foreground">
                {t('emptyHint')}
              </p>
              <div className="mt-4 flex justify-center">{createAction}</div>
            </div>
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="journal-status" label={t('filterByStatus')}>
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
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => setStatus('')}
        toolbarActions={createAction}
      />
    </div>
  );
}
