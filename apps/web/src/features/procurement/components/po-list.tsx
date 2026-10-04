'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Button,
  EmptyState,
  StatusText,
  type FilterValues,
  type ListFilterField,
  type StatusTone,
} from '@erp/ui';
import { Plus } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { formatDate, formatMoney } from '@/lib/format';

import { useCancelPurchaseOrder, usePurchaseOrders, useSuppliers } from '../hooks/use-procurement';
import { latestRevision } from '../quantities';
import type { PurchaseOrder, PurchaseOrderDeliveryStatus, PurchaseOrderStatus } from '../types';
import { ListRowMenu, errorText } from './list-row-menu';
import { ProcurementStatusBadge } from './procurement-badges';

const STATUSES: PurchaseOrderStatus[] = ['DRAFT', 'OPEN', 'CLOSED', 'CANCELLED'];

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
 * Purchase order list (shared list pattern, clients-list reference).
 *
 * Status, Project and Supplier run on the server. Project, Total and Delivery come from the
 * enriched list read; until it ships they render "—" rather than a figure the plain row cannot
 * support. Total follows the money gate: the server's `moneyVisible`, else
 * `view:commitment-ledger`; hidden money is an absent column, never $0.
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
  const [filters, setFilters] = useState<FilterValues>((): FilterValues =>
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
  );
  const orders = usePurchaseOrders({
    ...(filters.status ? { status: filters.status as PurchaseOrderStatus } : {}),
    ...(filters.project ? { projectId: filters.project } : {}),
    ...(filters.supplier ? { supplierId: filters.supplier } : {}),
  });
  const suppliers = useSuppliers();
  const cancel = useCancelPurchaseOrder();
  const [cancelling, setCancelling] = useState<PurchaseOrder | null>(null);

  const rows = useMemo(() => orders.data ?? [], [orders.data]);
  const moneyVisible =
    rows.find((po) => po.moneyVisible !== undefined)?.moneyVisible ??
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
      plainValue: (po) => `${po.poNumber} ${po.supplier?.name ?? ''}`,
      // The grid wraps this cell in the row's one link.
      render: (po) => {
        const revision = poRevisionNumber(po);
        return (
          <span className="block min-w-0">
            <span className="block font-semibold text-brand-primary">
              {po.poNumber}
              {revision !== null && revision > 1 ? (
                <span className="font-normal text-muted-foreground">
                  {' · '}
                  {t('revision', { number: revision })}
                </span>
              ) : null}
            </span>
            <span className="block max-w-[18rem] truncate text-caption font-normal text-muted-foreground">
              {po.supplier?.name ?? tc('notAvailable')}
            </span>
          </span>
        );
      },
    },
    {
      key: 'project',
      header: t('columns.project'),
      sortable: true,
      card: 'subtitle',
      plainValue: (po) => po.project?.name ?? '',
      render: (po) =>
        po.project ? <span className="block max-w-[16rem] truncate">{po.project.name}</span> : dash,
    },
    {
      key: 'ordered',
      header: t('columns.ordered'),
      sortable: true,
      card: 'meta',
      plainValue: (po) => latestRevision(po.revisions)?.effectiveFrom ?? '',
      render: (po, ctx) => formatDate(latestRevision(po.revisions)?.effectiveFrom, ctx.locale) ?? dash,
    },
    {
      key: 'delivery',
      header: t('columns.delivery'),
      sortable: true,
      plainValue: (po) => (po.deliveryStatus ? t(`delivery.${po.deliveryStatus}`) : ''),
      render: (po) =>
        po.deliveryStatus ? (
          <StatusText tone={DELIVERY_TONE[po.deliveryStatus]}>{t(`delivery.${po.deliveryStatus}`)}</StatusText>
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
        po.total == null ? dash : <span className="tabular-nums">{formatMoney(po.total, 'USD')}</span>,
    });
  }
  columns.push({
    key: 'status',
    header: t('columns.status'),
    card: 'status',
    render: (po) => <ProcurementStatusBadge vocabulary="purchaseOrder" status={po.status} />,
  });

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filters.status'),
      options: STATUSES.map((value) => ({ value, label: tStatus(value) })),
    },
    { key: 'project', type: 'select', label: t('filters.project'), options: projectFilter.options },
    { key: 'supplier', type: 'select', label: t('filters.supplier'), options: supplierOptions },
  ];

  const isNarrowed = Object.values(filters).some(Boolean);
  const isFirstUse = !isNarrowed && orders.data !== undefined && rows.length === 0;

  const createAction = mayCreate ? (
    <Button asChild>
      <Link href="/procurement/orders/new">
        <Plus className="size-4" aria-hidden="true" />
        {t('new')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-3">
      <PlatformDataGrid
        columns={columns}
        data={rows}
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
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={setFilters}
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
            <EmptyState title={t('empty')} description={t('emptyHint')} action={createAction} />
          ) : undefined
        }
        toolbarActions={createAction}
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
