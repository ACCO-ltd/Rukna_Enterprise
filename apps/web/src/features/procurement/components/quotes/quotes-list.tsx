'use client';

/**
 * `/procurement/quotes` — the buyer's "Quotes to collect" list (spec Q11). Four queues as one row
 * of large toggle buttons; each queue is a `PlatformDataGrid` that turns into cards on a phone.
 */

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, cn } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatMoney } from '@/lib/format';

import { useResumeQuoteUploads } from '../../hooks/use-quote-uploads';
import { useQuotationRequests } from '../../hooks/use-quotations';
import type { QuotationQueue, QuotationRequestRow } from '../../quotations/types';
import { QuotationStatusPill, WaitingTime } from './quote-shared';

const QUEUES = ['collect', 'returned', 'waiting', 'awarded'] as const satisfies readonly QuotationQueue[];
type CollectorQueue = (typeof QUEUES)[number];

export function QuotesList() {
  const t = useTranslations('procurement.quotes.list');
  const tq = useTranslations('procurement.quotes');
  const tReason = useTranslations('procurement.quotes.exceptionReason');
  const [chosen, setQueue] = useState<CollectorQueue | null>(null);
  // Open on "Returned to you" when finance sent something back — that is the buyer's first job.
  const returned = useQuotationRequests({ queue: 'returned', mine: true, limit: 1 }, { enabled: chosen === null });
  const queue: CollectorQueue = chosen ?? ((returned.data?.total ?? 0) > 0 ? 'returned' : 'collect');
  useResumeQuoteUploads();
  // The buyer's own requests on their working queues; "Chosen — raise order" shows every award, since
  // any buyer who may create orders can raise it.
  const rows = useQuotationRequests(
    { queue, ...(queue === 'awarded' ? {} : { mine: true }) },
    { poll: queue === 'waiting' },
  );
  const data = rows.data?.items ?? [];
  const moneyVisible = data.some((row) => row.moneyVisible);

  const columns: GridColumn<QuotationRequestRow>[] = [
    {
      key: 'request',
      header: t('columns.request'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (row) => `${row.mr.number} ${row.mr.title ?? ''} ${row.number}`,
      render: (row) => (
        <span className="block min-h-11 min-w-0">
          <span className="block font-semibold text-brand-primary">{row.mr.number}</span>
          <span className="block max-w-[20rem] truncate text-caption font-normal text-muted-foreground">
            {row.mr.title ?? row.number}
          </span>
        </span>
      ),
    },
    {
      key: 'project',
      header: t('columns.project'),
      sortable: true,
      card: 'subtitle',
      plainValue: (row) => row.project?.name ?? t('overhead'),
      render: (row) => <span className="block max-w-[16rem] truncate">{row.project?.name ?? t('overhead')}</span>,
    },
    {
      key: 'quotes',
      header: t('columns.quotes'),
      card: 'meta',
      plainValue: (row) => row.distinctSupplierCount,
      render: (row) => (
        <span className="block">
          <span className="tabular-nums">
            {tq('count.label', { count: row.distinctSupplierCount, required: row.requiredQuoteCount })}
          </span>
          {row.exceptionReason ? (
            <span className="block text-caption font-medium text-warning">{tReason(row.exceptionReason)}</span>
          ) : null}
        </span>
      ),
    },
  ];
  if (queue === 'waiting') {
    columns.push({
      key: 'waiting',
      header: t('columns.waiting'),
      sortable: true,
      card: 'meta',
      plainValue: (row) => row.waitingWorkingMinutes ?? -1,
      render: (row) => <WaitingTime minutes={row.waitingWorkingMinutes} tone={row.slaTone} />,
    });
  }
  if (queue === 'awarded' && moneyVisible) {
    columns.push({
      key: 'awarded',
      header: t('columns.awarded'),
      numeric: true,
      card: 'amount',
      plainValue: (row) => (row.awardedTotal == null ? null : Number(row.awardedTotal)),
      render: (row) =>
        row.awardedTotal == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{formatMoney(row.awardedTotal, 'USD')}</span>
        ),
    });
  }
  columns.push({
    key: 'status',
    header: t('columns.status'),
    card: 'status',
    render: (row) => <QuotationStatusPill status={row.status} />,
  });

  return (
    <div className="space-y-4">
      <p className="max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>

      <div role="group" aria-label={t('queueLabel')} className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {QUEUES.map((value) => (
          <Button
            key={value}
            type="button"
            variant={queue === value ? 'default' : 'outline'}
            aria-pressed={queue === value}
            className={cn('min-h-11 whitespace-normal text-center leading-tight')}
            onClick={() => setQueue(value)}
          >
            {t(`queue.${value}`)}
          </Button>
        ))}
      </div>

      <PlatformDataGrid
        columns={columns}
        data={data}
        rowKey={(row) => row.id}
        label={t(`queue.${queue}`)}
        isLoading={rows.isPending}
        isError={rows.isError}
        errorMessage={tq('loadFailed')}
        onRetry={() => void rows.refetch()}
        rowHref={(row) => `/procurement/quotes/${row.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        emptyState={
          <EmptyState
            title={t(`empty.${queue}`)}
            description={t(`empty.${queue}Hint`)}
            action={
              queue === 'collect' ? (
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/procurement/requests">{t('openRequests')}</Link>
                </Button>
              ) : undefined
            }
          />
        }
      />
    </div>
  );
}
