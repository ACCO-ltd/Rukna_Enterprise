'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge, Button, FilterBar, FilterField, Input, Select } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useClients } from '@/features/clients/hooks/use-clients';
import { formatDate, formatMoney } from '@/lib/format';

import { useReceipts } from '../hooks/use-receipts';
import type { Receipt } from '../types';

export function ReceiptsList() {
  const t = useTranslations('platform.receipts');
  const locale = useLocale() as 'en' | 'ar';

  const [clientId, setClientId] = useState('');
  const [search, setSearch] = useState('');

  // The client filter is applied SERVER-side — `clientId` is the one parameter
  // `GET /receipts` accepts — while the reference search is client-side, since the
  // endpoint offers no text search.
  const { data, isPending, isError, refetch } = useReceipts(clientId || undefined);
  const clients = useClients();

  const clientNames = useMemo(
    () => new Map((clients.data ?? []).map((c) => [c.id, c.name])),
    [clients.data],
  );

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return data ?? [];
    return (data ?? []).filter((r) => r.reference?.toLowerCase().includes(needle));
  }, [data, search]);

  const columns: GridColumn<Receipt>[] = [
    {
      key: 'date',
      header: t('columns.date'),
      sticky: true,
      sortable: true,
      plainValue: (receipt) => receipt.receiptDate,
      render: (receipt, ctx) => (
        <span className="font-medium text-foreground">
          {formatDate(receipt.receiptDate, ctx.locale)}
        </span>
      ),
    },
    {
      key: 'reference',
      header: t('columns.reference'),
      sortable: true,
      plainValue: (receipt) => receipt.reference ?? '',
      render: (receipt) => (
        <span className="font-mono text-caption">
          {receipt.reference ?? <span className="text-muted-foreground">{t('noReference')}</span>}
        </span>
      ),
    },
    {
      key: 'client',
      header: t('columns.client'),
      sortable: true,
      // `GET /receipts` returns `clientId` with no expansion, so the name is joined from
      // the clients list. Falls back to nothing rather than showing a cuid.
      plainValue: (receipt) => clientNames.get(receipt.clientId) ?? '',
      render: (receipt) =>
        clientNames.get(receipt.clientId) ?? (
          <span className="text-muted-foreground">{t('notSet')}</span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (receipt) => (
        <Badge
          tone={
            receipt.postingStatus === 'POSTED'
              ? 'live'
              : receipt.postingStatus === 'REVERSED'
                ? 'danger'
                : 'warning'
          }
        >
          {t(`status.${receipt.postingStatus === 'POSTED' ? 'posted' : receipt.postingStatus === 'REVERSED' ? 'reversed' : 'notPosted'}`)}
        </Badge>
      ),
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      numeric: true,
      sortable: true,
      plainValue: (receipt) => Number(receipt.totalAmount),
      render: (receipt) => <bdi>{formatMoney(receipt.totalAmount, receipt.currencyCode, locale)}</bdi>,
    },
  ];

  return (
    <div className="space-y-4">
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(receipt) => receipt.id}
        label={t('title')}
        isLoading={isPending}
        isError={isError}
        errorMessage={t('loadFailed')}
        onRetry={() => void refetch()}
        rowHref={(receipt) => `/receipts/${receipt.id}`}
        emptyState={
          (data?.length ?? 0) === 0 && !clientId ? (
            <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
              <p className="text-sm font-medium text-foreground">{t('empty')}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
              <div className="mt-4">
                <Button asChild>
                  <Link href="/receipts/new">{t('newReceipt')}</Link>
                </Button>
              </div>
            </div>
          ) : undefined
        }
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarFilters={
          <FilterBar>
            <FilterField id="receipt-search" label={t('searchLabel')} hideLabel grow>
              <Input
                id="receipt-search"
                type="search"
                placeholder={t('searchPlaceholder')}
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
            </FilterField>

            <FilterField id="receipt-client" label={t('filterByClient')}>
              <Select
                id="receipt-client"
                value={clientId}
                onChange={(value) => {
                  setClientId(value);
                }}
              >
                <option value="">{t('allClients')}</option>
                {(clients.data ?? []).map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </Select>
            </FilterField>
          </FilterBar>
        }
        onClearFilters={() => {
          setSearch('');
          setClientId('');
        }}
      />
    </div>
  );
}
