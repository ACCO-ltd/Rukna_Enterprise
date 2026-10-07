'use client';

/**
 * `/finance/quotes` — "Quotes to choose" (spec Q12, wireframe D). The decide queue, longest wait
 * first, with the server's SLA tone (amber ≥ 2 working hours, red ≥ 4; the label is always
 * written, never colour alone). A card per request on a phone, a grid on a desktop.
 */

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatMoney } from '@/lib/format';

import { useQuotationRequests } from '../../hooks/use-quotations';
import { byWaitingDesc } from '../../quotations/quote-rules';
import type { QuotationRequestRow } from '../../quotations/types';
import { WaitingTime } from './quote-shared';

export function QuotesInbox() {
  const t = useTranslations('procurement.quotes.inbox');
  const tList = useTranslations('procurement.quotes.list');
  const tq = useTranslations('procurement.quotes');
  const tReason = useTranslations('procurement.quotes.exceptionReason');
  const rows = useQuotationRequests({ queue: 'decide' }, { poll: true });
  const data = useMemo(() => byWaitingDesc(rows.data?.items ?? []), [rows.data]);
  const moneyVisible = data.length === 0 || data.some((row) => row.moneyVisible);

  const columns: GridColumn<QuotationRequestRow>[] = [
    {
      key: 'request',
      header: tList('columns.request'),
      sticky: true,
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
      header: tList('columns.project'),
      card: 'subtitle',
      plainValue: (row) => row.project?.name ?? tList('overhead'),
      render: (row) => <span className="block max-w-[16rem] truncate">{row.project?.name ?? tList('overhead')}</span>,
    },
    {
      key: 'quotes',
      header: tList('columns.quotes'),
      card: 'meta',
      plainValue: (row) => row.distinctSupplierCount,
      render: (row) => (
        <span className="block">
          <span className="tabular-nums">
            {tq('count.label', { count: row.distinctSupplierCount, required: row.requiredQuoteCount })}
          </span>
          {row.exceptionReason ? (
            <span className="ms-1.5 rounded-full bg-warning-subtle px-2 py-0.5 text-caption font-medium text-foreground">
              {tReason(row.exceptionReason)}
            </span>
          ) : null}
          {row.status === 'AWARD_PENDING_APPROVAL' ? (
            <span className="block text-caption text-muted-foreground">{t('pendingApproval')}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'waiting',
      header: tList('columns.waiting'),
      card: 'status',
      plainValue: (row) => row.waitingWorkingMinutes ?? -1,
      render: (row) => <WaitingTime minutes={row.waitingWorkingMinutes} tone={row.slaTone} />,
    },
  ];
  if (moneyVisible) {
    columns.push({
      key: 'estimate',
      header: tList('columns.estimate'),
      numeric: true,
      card: 'amount',
      plainValue: (row) => (row.estimateAmount == null ? null : Number(row.estimateAmount)),
      render: (row) =>
        row.estimateAmount == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{formatMoney(row.estimateAmount, 'USD')}</span>
        ),
    });
  }

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
      <PlatformDataGrid
        columns={columns}
        data={data}
        rowKey={(row) => row.id}
        label={t('title')}
        isLoading={rows.isPending}
        isError={rows.isError}
        errorMessage={tq('loadFailed')}
        onRetry={() => void rows.refetch()}
        rowHref={(row) => `/finance/quotes/${row.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        sortControl={false}
        emptyState={<EmptyState title={t('empty')} description={t('emptyHint')} />}
      />
      {!moneyVisible ? <p className="text-caption text-muted-foreground">{t('moneyHidden')}</p> : null}
    </div>
  );
}
