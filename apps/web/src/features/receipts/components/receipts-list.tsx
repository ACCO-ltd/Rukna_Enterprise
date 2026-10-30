'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import {
  Avatar,
  Button,
  cn,
  entityTintClass,
  EmptyState,
  type FilterValues,
  type ListFilterField,
  StatusPill,
} from '@erp/ui';
import type { SavedViewState } from '@erp/types';

import { ListPageHeader } from '@/components/layout/list-page-header';
import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { formatDate, formatMoney } from '@/lib/format';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';

import { useReceipts } from '../hooks/use-receipts';
import { isReceiptPaymentMethod } from '../payment-methods';
import { RECEIPT_LIST_STATE_TONE, receiptListState, type ReceiptListState } from '../receipt-list-state';
import type { Receipt } from '../types';

const DEFAULT_RECEIPT_SORT: SortState = { key: 'date', direction: 'desc' };

/** The one Status filter: what is left to do with a receipt, in the order the work happens. */
const STATUS_FILTER = ['NOT_POSTED', 'UNALLOCATED', 'RECEIVED', 'CLOSED'] as const;
const STATUS_GROUP: Record<ReceiptListState, (typeof STATUS_FILTER)[number] | null> = {
  NOT_POSTED: 'NOT_POSTED',
  CHEQUE_ON_HAND: 'NOT_POSTED',
  POSTING: 'NOT_POSTED',
  POSTING_FAILED: 'NOT_POSTED',
  UNALLOCATED: 'UNALLOCATED',
  RECEIVED: 'RECEIVED',
  REVERSED: 'CLOSED',
  CANCELLED: 'CLOSED',
};

/** Whether a receipt passes the browser-side filters (`client` and `project` go to the API). */
export function receiptMatchesFilters(receipt: Receipt, filters: FilterValues): boolean {
  if (filters.status && STATUS_GROUP[receiptListState(receipt)] !== filters.status) return false;
  // Views saved before the Status filter (2026-10-30) keep working.
  if (filters.posting && receipt.postingStatus !== filters.posting) return false;
  if (filters.allocation === 'unallocated' && toMinorUnits(receipt.unallocatedAmount, 2) <= 0)
    return false;
  return true;
}

export function ReceiptsList({
  projectId,
}: {
  /** ADR-043 Phase 2: fixes the list to receipts allocated to an invoice of this project. */
  projectId?: string;
} = {}) {
  const t = useTranslations('platform.receipts');
  const tMethod = useTranslations('platform.receipts.method');
  const locale = useLocale() as 'en' | 'ar';
  const today = todayWireDate();

  // `?projectId=` lets a project link in already narrowed (applied server-side).
  const projectFilter = useProjectFilter();
  const view = useListViewState(
    DEFAULT_RECEIPT_SORT,
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
  );
  const { filters } = view;
  const effectiveProjectId = projectId ?? (filters.project || undefined);

  // The client and project filters are applied SERVER-side — the parameters `GET /receipts`
  // accepts. Text search (reference, client, amount) is the grid's own.
  const { data, isPending, isError, refetch } = useReceipts(filters.client || undefined, {
    projectId: effectiveProjectId,
  });
  const clients = useClients();
  const clientNames = useMemo(
    () => new Map((clients.data ?? []).map((c) => [c.id, c.name])),
    [clients.data],
  );

  const all = useMemo(() => data ?? [], [data]);
  const visible = useMemo(
    () => all.filter((receipt) => receiptMatchesFilters(receipt, filters)),
    [all, filters],
  );

  const filterFields: ListFilterField[] = [
    {
      key: 'client',
      type: 'select',
      label: t('columns.client'),
      options: (clients.data ?? []).map((client) => ({ value: client.id, label: client.name })),
    },
    {
      key: 'status',
      type: 'select',
      label: t('columns.status'),
      options: STATUS_FILTER.map((s) => ({ value: s, label: t(`statusFilter.${s}`) })),
    },
    ...(projectId
      ? []
      : [
          {
            key: 'project',
            type: 'select' as const,
            label: t('filterByProject'),
            options: projectFilter.options,
          },
        ]),
  ];

  const columns: GridColumn<Receipt>[] = [
    {
      key: 'number',
      header: t('columns.number'),
      sticky: true,
      sortable: true,
      // Search finds a receipt by its cheque number, transaction ID or transfer reference too.
      plainValue: (receipt) =>
        [receipt.receiptNumber, receipt.instrumentNumber, receipt.reference].filter(Boolean).join(' '),
      exportValue: (receipt) =>
        receipt.receiptNumber ?? (receipt.documentStatus === 'CANCELLED' ? t('listState.CANCELLED') : t('unnumbered')),
      render: (receipt) => (
        <span className="block">
          <span
            className={cn(
              'block text-body-sm font-semibold text-brand-primary',
              receipt.receiptNumber ? 'font-mono' : 'italic',
            )}
          >
            {receipt.receiptNumber ?? (receipt.documentStatus === 'CANCELLED' ? t('listState.CANCELLED') : t('unnumbered'))}
          </span>
          {receipt.instrumentNumber || receipt.reference ? (
            <span className="block max-w-[12rem] truncate font-mono text-caption text-muted-foreground">
              {receipt.instrumentNumber ?? receipt.reference}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'client',
      header: t('columns.client'),
      sortable: true,
      // `GET /receipts` returns `clientId` with no expansion, so the name is joined from the
      // clients list. Falls back to "Not set" rather than showing a cuid.
      plainValue: (receipt) => clientNames.get(receipt.clientId) ?? '',
      render: (receipt) => {
        const name = clientNames.get(receipt.clientId);
        return name ? (
          <span className="flex items-center gap-2.5">
            <Avatar
              name={name}
              size="sm"
              className={cn('rounded-control ring-0', entityTintClass(receipt.clientId))}
            />
            <span className="block max-w-[16rem] truncate font-medium">{name}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('notSet')}</span>
        );
      },
    },
    {
      key: 'date',
      header: t('columns.date'),
      sortable: true,
      plainValue: (receipt) => receipt.receiptDate,
      render: (receipt, ctx) => (
        <span className="whitespace-nowrap">{formatDate(receipt.receiptDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'into',
      header: t('columns.into'),
      plainValue: (receipt) =>
        [receipt.bankAccount?.accountName, isReceiptPaymentMethod(receipt.paymentMethod) ? tMethod(receipt.paymentMethod) : receipt.paymentMethod]
          .filter(Boolean)
          .join(' · '),
      render: (receipt) => (
        <span className="block min-w-0">
          <span className="block max-w-[14rem] truncate">{receipt.bankAccount?.accountName ?? '—'}</span>
          {receipt.paymentMethod ? (
            <span className="block text-caption text-muted-foreground">
              {isReceiptPaymentMethod(receipt.paymentMethod) ? tMethod(receipt.paymentMethod) : receipt.paymentMethod}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'amount',
      header: t('columns.amount'),
      numeric: true,
      sortable: true,
      plainValue: (receipt) => Number(receipt.totalAmount),
      render: (receipt) => (
        <bdi className="font-semibold">
          {formatMoney(receipt.totalAmount, receipt.currencyCode, locale)}
        </bdi>
      ),
    },
    {
      key: 'unallocated',
      header: t('columns.unallocated'),
      numeric: true,
      sortable: true,
      // Only a posted receipt holds money on account; before posting (or cancelled) nothing is held.
      plainValue: (receipt) => (receipt.postingStatus === 'POSTED' ? Number(receipt.unallocatedAmount) : 0),
      render: (receipt) =>
        receipt.postingStatus !== 'POSTED' ? (
          <span className="text-muted-foreground">—</span>
        ) : (
        <bdi
          className={
            toMinorUnits(receipt.unallocatedAmount, 2) > 0
              ? 'font-medium text-warning'
              : 'text-muted-foreground'
          }
        >
          {formatMoney(receipt.unallocatedAmount, receipt.currencyCode, locale)}
        </bdi>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      plainValue: (receipt) => t(`listState.${receiptListState(receipt)}`),
      render: (receipt) => (
        <StatusPill tone={RECEIPT_LIST_STATE_TONE[receiptListState(receipt)]}>
          {t(`listState.${receiptListState(receipt)}`)}
        </StatusPill>
      ),
    },
  ];

  // Views (Step 2a). Client and project are the API's filters: a count is shown only while a
  // view asks for the client and project that are loaded.
  const countFor = (viewState: SavedViewState): number | undefined => {
    const f = viewState.filters ?? {};
    if ((f.client ?? '') !== (filters.client ?? '')) return undefined;
    if (!projectId && (f.project ?? '') !== (filters.project ?? '')) return undefined;
    return searchRows(
      all.filter((receipt) => receiptMatchesFilters(receipt, f)),
      viewState.search ?? '',
      columns,
    ).length;
  };
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_RECEIPT_SORT } },
    {
      id: 'notPosted',
      label: t('views.notPosted'),
      state: { filters: { status: 'NOT_POSTED' }, sort: DEFAULT_RECEIPT_SORT },
    },
    {
      id: 'unallocated',
      label: t('views.unallocated'),
      state: { filters: { status: 'UNALLOCATED' }, sort: DEFAULT_RECEIPT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const createAction = (
    <Button asChild>
      <Link href="/receipts/new" data-shortcut-new="">
        <Plus size={16} aria-hidden="true" />
        {t('newReceipt')}
        <kbd
          className="hidden rounded border border-white/40 px-1 font-mono text-micro md:inline"
          aria-hidden="true"
        >
          N
        </kbd>
      </Link>
    </Button>
  );

  // Received counts posted receipts only; on account is what they still hold for the client.
  const postedRows = all.filter((receipt) => receipt.postingStatus === 'POSTED');
  const receivedMinor = postedRows.reduce((sum, receipt) => sum + toMinorUnits(receipt.totalAmount, 2), 0);
  const onAccountMinor = postedRows.reduce((sum, receipt) => sum + toMinorUnits(receipt.unallocatedAmount, 2), 0);
  const usd = (minor: number) => formatMoney(fromMinorUnits(minor, 2), 'USD', locale) ?? '—';
  const headerSummary =
    all.length === 0
      ? undefined
      : onAccountMinor > 0
        ? t('headerSummaryOnAccount', { count: all.length, received: usd(receivedMinor), onAccount: usd(onAccountMinor) })
        : t('headerSummary', { count: all.length, received: usd(receivedMinor) });

  const grid = (
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
        all.length === 0 && !filters.client && !effectiveProjectId ? (
          <EmptyState title={t('empty')} description={t('emptyHint')} action={createAction} />
        ) : undefined
      }
      searchLabel={t('searchLabel')}
      searchPlaceholder={t('searchPlaceholder')}
      noMatchMessage={t('noMatches')}
      resultLabel={(count) => t('countLabel', { count })}
      pagination={{ defaultPageSize: 25 }}
      columnVisibility
      listState={view.listState}
      savedViews={
        <ListViewsBar
          listKey={projectId ? 'project-receipts' : 'receipts'}
          builtIns={builtIns}
          current={view.current}
          onApply={view.applyView}
          countFor={countFor}
          label={t('views.label')}
        />
      }
      exportAs={{ fileName: `receipts-${today}`, sheetName: t('title') }}
      shortcuts={
        projectId
          ? undefined
          : {
              onNew: () =>
                document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click(),
            }
      }
      filters={filterFields}
      filterValues={filters}
      onFilterValuesChange={view.setFilters}
      toolbarActions={projectId ? createAction : undefined}
    />
  );

  if (projectId) return grid;
  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={headerSummary}
        actions={createAction}
      />
      {grid}
    </div>
  );
}
