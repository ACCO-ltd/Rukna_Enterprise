'use client';

/**
 * `/finance/payments-needed` — "Payments needed" (ADR-045 §6, spec P11). Two queues, longest
 * wait first, with the server's waiting tone (written, never colour alone):
 *
 *   To pay    — award orders issued and not fully funded: release cash or pay the store.
 *   To settle — store receipts waiting to be recorded, and cash still with a buyer.
 *
 * Each row opens the request's Payment section, where the one primary action is.
 */

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatMoney } from '@/lib/format';

import { useQuotationRequests } from '../../hooks/use-quotations';
import { byWaitingDesc } from '../../quotations/quote-rules';
import type { QuotationRequestRow } from '../../quotations/types';
import { PaymentStatePill } from './payment-shared';
import { WaitingTime } from './quote-shared';

type PaymentQueue = 'pay' | 'settle';

export function PaymentsQueue({ initialQueue = 'pay' }: { initialQueue?: PaymentQueue }) {
  const t = useTranslations('procurement.quotes.paymentsQueue');
  const [queue, setQueue] = useState<PaymentQueue>(initialQueue);
  const pay = useQuotationRequests({ queue: 'pay' }, { poll: true });
  const settle = useQuotationRequests({ queue: 'settle' }, { poll: true });

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
      <Tabs value={queue} onValueChange={(next) => setQueue(next as PaymentQueue)}>
        <TabsList>
          <TabsTrigger value="pay" className="min-h-11">
            {t('tabs.pay')}
            {pay.data ? <span className="ms-1.5 tabular-nums text-muted-foreground">{pay.data.total}</span> : null}
          </TabsTrigger>
          <TabsTrigger value="settle" className="min-h-11">
            {t('tabs.settle')}
            {settle.data ? <span className="ms-1.5 tabular-nums text-muted-foreground">{settle.data.total}</span> : null}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="pay">
          <QueueGrid query={pay} queue="pay" />
        </TabsContent>
        <TabsContent value="settle">
          <QueueGrid query={settle} queue="settle" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function QueueGrid({ query, queue }: { query: ReturnType<typeof useQuotationRequests>; queue: PaymentQueue }) {
  const t = useTranslations('procurement.quotes.paymentsQueue');
  const tList = useTranslations('procurement.quotes.list');
  const tq = useTranslations('procurement.quotes');
  const tPath = useTranslations('procurement.quotes.payment.path');
  const data = useMemo(() => byWaitingDesc(query.data?.items ?? []), [query.data]);
  const moneyVisible = data.length === 0 || data.some((row) => row.moneyVisible);

  const columns: GridColumn<QuotationRequestRow>[] = [
    {
      key: 'request',
      header: tList('columns.request'),
      sticky: true,
      card: 'title',
      plainValue: (row) => `${row.mr.number} ${row.mr.title ?? ''} ${row.number} ${row.supplierName ?? ''}`,
      render: (row) => (
        <span className="block min-h-11 min-w-0">
          <span className="block font-semibold text-brand-primary">{row.supplierName ?? row.mr.number}</span>
          <span className="block max-w-[20rem] truncate text-caption font-normal text-muted-foreground">
            {[row.mr.number, row.purchaseOrder?.poNumber, row.mr.title].filter(Boolean).join(' · ')}
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
      key: 'state',
      header: t('columns.state'),
      card: 'meta',
      plainValue: (row) => row.paymentState ?? '',
      render: (row) => (
        <span className="flex flex-wrap items-center gap-1.5">
          {row.paymentState ? <PaymentStatePill state={row.paymentState} /> : null}
          {row.paymentPath ? <span className="text-caption text-muted-foreground">{tPath(row.paymentPath)}</span> : null}
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
      key: 'amount',
      header: t('columns.amount'),
      numeric: true,
      card: 'amount',
      plainValue: (row) => (row.remainingToFund == null ? null : Number(row.remainingToFund)),
      render: (row) =>
        row.remainingToFund == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="tabular-nums">{formatMoney(row.remainingToFund, 'USD')}</span>
        ),
    });
  }

  return (
    <div className="space-y-3 pt-3">
      <PlatformDataGrid
        columns={columns}
        data={data}
        rowKey={(row) => row.id}
        label={t(`tabs.${queue}`)}
        isLoading={query.isPending}
        isError={query.isError}
        errorMessage={tq('loadFailed')}
        onRetry={() => void query.refetch()}
        rowHref={(row) => `/finance/quotes/${row.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        sortControl={false}
        emptyState={<EmptyState title={t(`empty.${queue}`)} description={t(`emptyHint.${queue}`)} />}
      />
      {!moneyVisible ? <p className="text-caption text-muted-foreground">{t('moneyHidden')}</p> : null}
    </div>
  );
}
