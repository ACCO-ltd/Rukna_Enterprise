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
import { RECEIPT_LIST_STATE_TONE, receiptListState } from '../receipt-list-state';
import type { Receipt } from '../types';

const DEFAULT_RECEIPT_SORT: SortState = { key: 'date', direction: 'desc' };

/** Whether a receipt passes the browser-side filters (`client` and `project` go to the API). */
export function receiptMatchesFilters(receipt: Receipt, filters: FilterValues): boolean {
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
      key: 'posting',
      type: 'select',
      label: t('filterByPosting'),
      options: (['NOT_POSTED', 'POSTED', 'REVERSED'] as const).map((s) => ({
        value: s,
        label: t(`postingFilter.${s}`),
      })),
    },
    {
      key: 'allocation',
      type: 'select',
      label: t('filterByAllocation'),
      options: [{ value: 'unallocated', label: t('allocationFilter.unallocated') }],
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
      plainValue: (receipt) => `${receipt.receiptNumber ?? ''} ${receipt.reference ?? ''}`.trim(),
      exportValue: (receipt) => receipt.receiptNumber ?? t('unnumbered'),
      render: (receipt) => (
        <span className="block">
          <span
            className={cn(
              'block text-body-sm font-semibold text-brand-primary',
              receipt.receiptNumber ? 'font-mono' : 'italic',
            )}
          >
            {receipt.receiptNumber ?? t('unnumbered')}
          </span>
          <span className="block text-caption text-muted-foreground">
            {receipt.reference ?? t('noReference')}
          </span>
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
      plainValue: (receipt) => Number(receipt.unallocatedAmount),
      render: (receipt) => (
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
      state: { filters: { posting: 'NOT_POSTED' }, sort: DEFAULT_RECEIPT_SORT },
    },
    {
      id: 'unallocated',
      label: t('views.unallocated'),
      state: { filters: { allocation: 'unallocated' }, sort: DEFAULT_RECEIPT_SORT },
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

  const currencies = new Set(all.map((receipt) => receipt.currencyCode));
  const receivedMinor = all
    .filter((receipt) => receipt.postingStatus === 'POSTED')
    .reduce((sum, receipt) => sum + toMinorUnits(receipt.totalAmount, 2), 0);
  const headerSummary =
    all.length === 0
      ? undefined
      : currencies.size === 1
        ? t('headerSummary', {
            count: all.length,
            received:
              formatMoney(fromMinorUnits(receivedMinor, 2), [...currencies][0], locale) ?? '—',
          })
        : t('headerCount', { count: all.length });

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
