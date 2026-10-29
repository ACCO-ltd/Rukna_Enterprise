'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Avatar,
  Button,
  cn,
  EmptyState,
  entityTintClass,
  StatusText,
  type FilterValues,
  type ListFilterField,
  type StatusTone,
} from '@erp/ui';
import { Plus, ShoppingCart } from 'lucide-react';
import type { SavedViewState } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { PlatformDataGrid, type GridColumn, type SortState } from '@/components/platform-data-grid';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { formatDate, formatMoney } from '@/lib/format';
import { fromMinorUnits, toMinorUnits } from '@/lib/money';

import { useCancelPurchaseOrder, usePurchaseOrders, useSuppliers } from '../hooks/use-procurement';
import { latestRevision } from '../quantities';
import type { PurchaseOrder, PurchaseOrderDeliveryStatus, PurchaseOrderStatus } from '../types';
import { ListRowMenu, errorText } from './list-row-menu';
import { ProcurementStatusBadge } from './procurement-badges';

const STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'];
const DELIVERIES: PurchaseOrderDeliveryStatus[] = ['NOT_RECEIVED', 'PARTLY_RECEIVED', 'RECEIVED'];

const DEFAULT_SORT: SortState = { key: 'ordered', direction: 'desc' };

/** Whether an order passes the list's filters (`project` and the search are the API's). */
export function poMatchesFilters(po: PurchaseOrder, filters: FilterValues): boolean {
  if (filters.status && po.status !== filters.status) return false;
  if (filters.supplier && po.supplierId !== filters.supplier) return false;
  if (filters.delivery && po.deliveryStatus !== filters.delivery) return false;
  return true;
}

const DELIVERY_TONE: Record<PurchaseOrderDeliveryStatus, StatusTone> = {
  NOT_RECEIVED: 'neutral',
  PARTLY_RECEIVED: 'progress',
  RECEIVED: 'success',
};

/**
 * The revision a reader should see named: the server's `activeRevisionNumber` when the enriched
 * list read sends it, else the listed revision only when it is the ACTIVE one — the list carries
 * the highest-numbered revision, which is a draft while an amendment is in progress (P14).
 */
export function poRevisionNumber(po: PurchaseOrder): number | null {
  if (po.activeRevisionNumber !== undefined) return po.activeRevisionNumber;
  const latest = latestRevision(po.revisions);
  return latest?.status === 'ACTIVE' ? latest.revisionNumber : null;
}

/**
 * Purchase order list (ADR-047 list page: title block, views, groups, export).
 *
 * Search and Project run on the server (an order spans projects; the row names only the first);
 * Status, Supplier, Delivery, views, sort, groups and export run on the returned set. Project,
 * Total, Delivery and the active revision come from the list read and render "—" when a row
 * has none. Total follows the server's `moneyVisible` (else `view:commitment-ledger`); hidden
 * money is an absent column, never $0.
 */
export function PoList() {
  const t = useTranslations('procurement.po.list');
  const tPo = useTranslations('procurement.po');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const { can } = usePermissions();
  const mayCreate = can(PROCUREMENT_PERMISSIONS.createOrder);

  // Pre-set from `?projectId=` so a project's "Open procurement" lands on its own orders.
  const projectFilter = useProjectFilter();
  const view = useListViewState(
    DEFAULT_SORT,
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
    { searchOnServer: true },
  );
  const { filters } = view;
  const orders = usePurchaseOrders({
    ...(filters.project ? { projectId: filters.project } : {}),
    ...(view.debouncedSearch ? { search: view.debouncedSearch } : {}),
  });
  const suppliers = useSuppliers();
  const cancel = useCancelPurchaseOrder();
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null);

  const all = useMemo(() => orders.data ?? [], [orders.data]);
  const visible = useMemo(() => all.filter((po) => poMatchesFilters(po, filters)), [all, filters]);
  const moneyVisible =
    all.find((po) => po.moneyVisible !== undefined)?.moneyVisible ??
    can(PROCUREMENT_PERMISSIONS.viewCommitments);

  const supplierOptions = useMemo(
    () =>
      (suppliers.data ?? [])
        .map((s) => ({ value: s.id, label: s.name }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [suppliers.data],
  );

  const dash = <span className="text-muted-foreground">{tc('notAvailable')}</span>;

  const columns: GridColumn<PurchaseOrder>[] = [
    {
      key: 'order',
      header: t('columns.order'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (po) => po.poNumber,
      // The grid wraps this cell in the row's one link.
      render: (po) => {
        const revision = poRevisionNumber(po);
        return (
          <span className="block font-mono text-body-sm font-semibold text-brand-primary">
            {po.poNumber}
            {revision !== null && revision > 1 ? (
              <span className="font-sans font-normal text-muted-foreground">
                {' · '}
                {t('revision', { number: revision })}
              </span>
            ) : null}
          </span>
        );
      },
    },
    {
      key: 'supplier',
      header: t('columns.supplier'),
      sortable: true,
      card: 'subtitle',
      plainValue: (po) => po.supplier?.name ?? '',
      render: (po) =>
        po.supplier ? (
          <span className="flex items-center gap-2.5">
            <Avatar
              name={po.supplier.name}
              size="sm"
              className={cn('rounded-control ring-0', entityTintClass(po.supplierId))}
            />
            <span className="block max-w-[16rem] truncate font-medium">{po.supplier.name}</span>
          </span>
        ) : (
          dash
        ),
    },
    {
      key: 'project',
      header: t('columns.project'),
      sortable: true,
      // An order with no project-coded line is overhead, named as the request list names it.
      plainValue: (po) => po.project?.name ?? tc('overhead'),
      render: (po) =>
        po.project ? (
          <span className="block min-w-0">
            <span className="block max-w-[16rem] truncate">{po.project.name}</span>
            {po.projectCount && po.projectCount > 1 ? (
              <span className="block text-caption text-muted-foreground">
                {tc('moreProjects', { count: po.projectCount - 1 })}
              </span>
            ) : null}
          </span>
        ) : (
          <span className="text-muted-foreground">{tc('overhead')}</span>
        ),
    },
    {
      key: 'ordered',
      header: t('columns.ordered'),
      sortable: true,
      card: 'meta',
      plainValue: (po) => latestRevision(po.revisions)?.effectiveFrom ?? '',
      render: (po, ctx) =>
        formatDate(latestRevision(po.revisions)?.effectiveFrom, ctx.locale) ?? dash,
    },
    {
      key: 'delivery',
      header: t('columns.delivery'),
      sortable: true,
      plainValue: (po) => (po.deliveryStatus ? t(`delivery.${po.deliveryStatus}`) : ''),
      render: (po) =>
        po.deliveryStatus ? (
          <StatusText tone={DELIVERY_TONE[po.deliveryStatus]}>
            {t(`delivery.${po.deliveryStatus}`)}
          </StatusText>
        ) : (
          dash
        ),
    },
  ];
  if (moneyVisible) {
    columns.push({
      key: 'total',
      header: t('columns.total'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (po) => (po.total == null ? null : Number(po.total)),
      render: (po) =>
        po.total == null ? (
          dash
        ) : (
          <span className="tabular-nums">{formatMoney(po.total, po.currencyCode ?? 'USD')}</span>
        ),
    });
  }
  columns.push({
    key: 'status',
    header: t('columns.status'),
    card: 'status',
    plainValue: (po) => tStatus(po.status),
    render: (po) => <ProcurementStatusBadge vocabulary="purchaseOrder" status={po.status} />,
  });

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filters.status'),
      options: STATUSES.map((value) => ({ value, label: tStatus(value) })),
    },
    {
      key: 'delivery',
      type: 'select',
      label: t('filters.delivery'),
      options: DELIVERIES.map((value) => ({ value, label: t(`delivery.${value}`) })),
    },
    { key: 'project', type: 'select', label: t('filters.project'), options: projectFilter.options },
    { key: 'supplier', type: 'select', label: t('filters.supplier'), options: supplierOptions },
  ];

  // Views (Step 8). The project and the search are the API's, so a count is shown only while the
  // view's project and search are the ones the rows were fetched with.
  const countFor = (state: SavedViewState): number | undefined => {
    const f = state.filters ?? {};
    if ((f.project ?? '') !== (filters.project ?? '')) return undefined;
    if ((state.search ?? '').trim() !== view.search.trim()) return undefined;
    return all.filter((po) => poMatchesFilters(po, f)).length;
  };
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_SORT } },
    {
      id: 'awaiting',
      label: t('views.awaiting'),
      state: { filters: { status: 'OPEN', delivery: 'NOT_RECEIVED' }, sort: DEFAULT_SORT },
    },
    {
      id: 'partly',
      label: t('views.partly'),
      state: { filters: { status: 'OPEN', delivery: 'PARTLY_RECEIVED' }, sort: DEFAULT_SORT },
    },
    {
      id: 'drafts',
      label: t('views.drafts'),
      state: { filters: { status: 'DRAFT' }, sort: DEFAULT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const isNarrowed = Boolean(view.search.trim()) || Object.values(filters).some(Boolean);
  const isFirstUse = !isNarrowed && orders.data !== undefined && all.length === 0;

  // Open orders' value, when every order is in one currency and money is visible.
  const currencies = new Set(all.map((po) => po.currencyCode ?? 'USD'));
  const singleCurrency = currencies.size === 1 ? [...currencies][0]! : null;
  // No total on any row is "nothing to add up" — never $0.
  const sumTotals = (rows: PurchaseOrder[]) =>
    !rows.some((po) => po.total != null)
      ? '—'
      : (formatMoney(
          fromMinorUnits(
            rows.reduce((sum, po) => sum + (po.total == null ? 0 : toMinorUnits(po.total, 2)), 0),
            2,
          ),
          singleCurrency,
        ) ?? '—');
  const openOrders = all.filter((po) => po.status === 'OPEN');
  const headerSummary =
    all.length === 0 || view.search.trim()
      ? undefined
      : moneyVisible && singleCurrency
        ? t('headerSummary', {
            count: all.length,
            open: openOrders.length,
            value: sumTotals(openOrders),
          })
        : t('headerCount', { count: all.length, open: openOrders.length });

  const createAction = mayCreate ? (
    <Button asChild>
      <Link href="/procurement/orders/new" data-shortcut-new="">
        <Plus className="size-4" aria-hidden="true" />
        {t('new')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={tPo('title')}
        summary={headerSummary}
        actions={createAction}
      />
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(po) => po.id}
        label={tPo('title')}
        isLoading={orders.isPending}
        isError={orders.isError}
        errorMessage={tc('loadFailed')}
        onRetry={() => void orders.refetch()}
        rowHref={(po) => `/procurement/orders/${po.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        pagination={{ defaultPageSize: 25 }}
        columnVisibility
        listState={view.listState}
        savedViews={
          <ListViewsBar
            listKey="purchase-orders"
            builtIns={builtIns}
            current={view.current}
            onApply={view.applyView}
            countFor={countFor}
            label={t('views.label')}
          />
        }
        groupOptions={[
          {
            key: 'supplier',
            label: t('columns.supplier'),
            groupOf: (po) => ({
              id: po.supplierId,
              label: po.supplier?.name ?? tc('notAvailable'),
            }),
          },
          {
            key: 'project',
            label: t('columns.project'),
            groupOf: (po) => ({
              id: po.project?.id ?? '',
              label: po.project?.name ?? tc('overhead'),
            }),
          },
          {
            key: 'status',
            label: t('columns.status'),
            groupOf: (po) => ({ id: po.status, label: tStatus(po.status) }),
          },
        ]}
        totals={
          moneyVisible && singleCurrency
            ? { label: (count) => t('countLabel', { count }), columns: { total: sumTotals } }
            : undefined
        }
        exportAs={{ fileName: `purchase-orders-${todayWireDate()}`, sheetName: tPo('title') }}
        shortcuts={{
          onNew: mayCreate
            ? () => document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click()
            : undefined,
        }}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={view.setFilters}
        rowActions={(po) => (
          <ListRowMenu
            label={tc('rowMenu', { number: po.poNumber })}
            openHref={`/procurement/orders/${po.id}`}
            openLabel={tc('open')}
            commands={
              mayCreate && po.status === 'DRAFT'
                ? [{ key: 'cancel', label: tPo('cancelOrder'), onSelect: () => setCancelling(po) }]
                : []
            }
          />
        )}
        emptyState={
          isFirstUse ? (
            <EmptyState
              icon={<ShoppingCart size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
              action={createAction}
            />
          ) : undefined
        }
      />
      {!moneyVisible && !orders.isPending && !orders.isError && !isFirstUse ? (
        <p className="text-caption text-muted-foreground">{t('moneyHidden')}</p>
      ) : null}

      {cancelling ? (
        <ConfirmActionDialog
          title={tPo('cancelTitle', { number: cancelling.poNumber })}
          description={tPo('cancelBody')}
          confirmLabel={tPo('cancelOrder')}
          destructive
          isPending={cancel.isPending}
          errorMessage={cancel.error ? errorText(cancel.error, tc('loadFailed')) : undefined}
          onConfirm={() => cancel.mutate(cancelling.id, { onSuccess: () => setCancelling(null) })}
          onDismiss={() => {
            cancel.reset();
            setCancelling(null);
          }}
        />
      ) : null}
    </div>
  );
}
