'use client';

/**
 * `/finance/payments-needed` — "Payments needed" (ADR-045 §6, spec P11). Two queues, longest
 * wait first:
 *
 *   To pay    — award orders issued and not fully funded: release cash or pay the store.
 *   To settle — store receipts waiting to be recorded, and cash still with a buyer.
 *
 * The age is `paymentWaitingWorkingMinutes` (since payment became needed, working hours). The
 * row carries no payment state of its own — the tab says what is waiting; each row opens the
 * request's Payment section, where the one primary action is. Above the tabs, the buyer-cash
 * set-up checklist when something is missing (P14, `GET /buyer-advances/readiness`).
 */

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { EmptyState, Notice, Tabs, TabsContent, TabsList, TabsTrigger } from '@erp/ui';
import { ArrowRight, CircleCheck, CircleDashed } from 'lucide-react';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatMoney } from '@/lib/format';

import { useBuyerCashReadiness } from '../../hooks/use-quotation-payment';
import { useQuotationRequests } from '../../hooks/use-quotations';
import type { QuotationRequestRow } from '../../quotations/types';
import { WaitingTime } from './quote-shared';

type PaymentQueue = 'pay' | 'settle';

/** Oldest first — the server already orders them so; kept stable on the client too. */
function byPaymentWaitDesc(rows: QuotationRequestRow[]): QuotationRequestRow[] {
  return [...rows].sort((a, b) => (b.paymentWaitingWorkingMinutes ?? -1) - (a.paymentWaitingWorkingMinutes ?? -1));
}

export function PaymentsQueue({ initialQueue = 'pay' }: { initialQueue?: PaymentQueue }) {
  const t = useTranslations('procurement.quotes.paymentsQueue');
  const [queue, setQueue] = useState<PaymentQueue>(initialQueue);
  const pay = useQuotationRequests({ queue: 'pay' }, { poll: true });
  const settle = useQuotationRequests({ queue: 'settle' }, { poll: true });

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-body-sm text-muted-foreground">{t('subtitle')}</p>
      <BuyerCashSetup />
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

/** The buyer-cash set-up checklist, only while something is missing (P14). */
function BuyerCashSetup() {
  const t = useTranslations('procurement.quotes.paymentsQueue.readiness');
  const readiness = useBuyerCashReadiness();
  const data = readiness.data;
  if (!data || data.ready) return null;
  const items = [
    { done: data.staffAdvanceProfile, label: t('profile'), href: '/finance/accounting/posting-profiles', action: t('profileAction') },
    {
      done: data.cashAccountsWithoutSignatories > 0,
      label: t('cashAccount'),
      href: '/finance/accounting/bank-accounts?preset=cash-box',
      action: t('cashAccountAction'),
    },
  ];
  return (
    <Notice tone="attention" title={t('title')}>
      <p className="mt-1">{t('body')}</p>
      <ul className="mt-2 space-y-1">
        {items.map((item) => (
          <li key={item.label} className="flex flex-wrap items-center gap-x-2">
            {item.done ? (
              <CircleCheck className="size-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <CircleDashed className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span>
              {item.label}
              <span className="sr-only"> — {item.done ? t('done') : t('missing')}</span>
            </span>
            {!item.done ? (
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center gap-1 font-medium text-brand-primary underline underline-offset-4"
              >
                {item.action}
                <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            ) : null}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

function QueueGrid({ query, queue }: { query: ReturnType<typeof useQuotationRequests>; queue: PaymentQueue }) {
  const t = useTranslations('procurement.quotes.paymentsQueue');
  const tList = useTranslations('procurement.quotes.list');
  const tq = useTranslations('procurement.quotes');
  const data = useMemo(() => byPaymentWaitDesc(query.data?.items ?? []), [query.data]);
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
            {[row.mr.title, row.number].filter(Boolean).join(' · ')}
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
      key: 'waiting',
      header: t(`columns.waiting.${queue}`),
      card: 'status',
      plainValue: (row) => row.paymentWaitingWorkingMinutes ?? -1,
      // No SLA tone for payments: the server sets none, and the client does not invent one.
      render: (row) => <WaitingTime minutes={row.paymentWaitingWorkingMinutes ?? null} tone="none" />,
    },
  ];
  if (moneyVisible) {
    columns.push({
      key: 'amount',
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
