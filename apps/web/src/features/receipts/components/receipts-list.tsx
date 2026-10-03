'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Button, FilterBar, FilterField, Select, StatusPill } from '@erp/ui';

import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { formatDate, formatMoney } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import { useReceipts } from '../hooks/use-receipts';
import type { Receipt } from '../types';

export function ReceiptsList({
  projectId,
}: {
  /** ADR-043 Phase 2: fixes the list to receipts allocated to an invoice of this project. */
  projectId?: string;
} = {}) {
  const t = useTranslations('platform.receipts');
  const locale = useLocale() as 'en' | 'ar';

  const [clientId, setClientId] = useState('');
  // `?projectId=` lets a project link in already narrowed (applied server-side).
  const projectFilter = useProjectFilter();
  const [filterProjectId, setFilterProjectId] = useState(projectFilter.initialProjectId ?? '');
  const effectiveProjectId = projectId ?? (filterProjectId || undefined);

  // The client filter is applied SERVER-side — `clientId` is the one parameter
  // `GET /receipts` accepts. Text search (reference, client, amount) is the grid's own: the
  // endpoint offers none, and a second search box beside the grid's was one too many.
  const { data, isPending, isError, refetch } = useReceipts(clientId || undefined, { projectId: effectiveProjectId });
  const clients = useClients();

  const clientNames = useMemo(
    () => new Map((clients.data ?? []).map((c) => [c.id, c.name])),
    [clients.data],
  );

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
        <StatusPill tone={statusTone(receipt.postingStatus, 'posting')}>
          {t(`status.${receipt.postingStatus === 'POSTED' ? 'posted' : receipt.postingStatus === 'REVERSED' ? 'reversed' : 'notPosted'}`)}
        </StatusPill>
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
        data={data ?? []}
        rowKey={(receipt) => receipt.id}
        label={t('title')}
        isLoading={isPending}
        isError={isError}
        errorMessage={t('loadFailed')}
        onRetry={() => void refetch()}
        rowHref={(receipt) => `/receipts/${receipt.id}`}
        emptyState={
          (data?.length ?? 0) === 0 && !clientId && !effectiveProjectId ? (
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
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        noMatchMessage={t('noMatches')}
        resultLabel={(count) => t('countLabel', { count })}
        pagination={{ defaultPageSize: 25 }}
        toolbarActions={
          <Button asChild>
            <Link href="/receipts/new">{t('newReceipt')}</Link>
          </Button>
        }
        toolbarFilters={
          <FilterBar>
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
            {projectId ? null : (
              <FilterField id="receipt-project" label={t('filterByProject')}>
                <Select id="receipt-project" value={filterProjectId} onChange={(value) => setFilterProjectId(value)}>
                  <option value="">{t('allProjects')}</option>
                  {projectFilter.options.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </FilterField>
            )}
          </FilterBar>
        }
        onClearFilters={() => {
          setClientId('');
          setFilterProjectId('');
        }}
      />
    </div>
  );
}
