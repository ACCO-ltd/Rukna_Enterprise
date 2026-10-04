'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, type FilterValues, type ListFilterField } from '@erp/ui';
import { Plus } from 'lucide-react';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { formatDate, formatMoney } from '@/lib/format';

import { useCancelMaterialRequest, useMaterialRequests } from '../hooks/use-procurement';
import type { MaterialRequest, MaterialRequestStatus } from '../types';
import { ListRowMenu, errorText } from './list-row-menu';
import { useListControls } from './use-list-controls';
import { ProcurementStatusBadge } from './procurement-badges';

const STATUSES: MaterialRequestStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_ORDERED',
  'FULLY_ORDERED',
  'CANCELLED',
  'CLOSED',
];

/** Still waiting on someone — where "Urgent" is worth a reader's attention. */
const OPEN_STATUSES: ReadonlySet<MaterialRequestStatus> = new Set([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_ORDERED',
]);

/** The "Requested for" filter's overhead choice — the API's `requestedFor=overhead`. */
export const OVERHEAD_FILTER = 'overhead';

/**
 * Material request list (shared list pattern, clients-list reference).
 *
 * Search, Status and "Requested for" run on the server (`search`, `status`, `requestedFor` = a
 * project id or `overhead`); sort and paging are local. The estimate is the server's
 * `estimatedTotal` and follows its `moneyVisible` verdict (else `view:commitment-ledger`):
 * hidden money is an absent column, never $0.
 */
export function MrList() {
  const t = useTranslations('procurement.mr.list');
  const tMr = useTranslations('procurement.mr');
  const tc = useTranslations('procurement.common');
  const tStatus = useTranslations('procurement.status');
  const { can } = usePermissions();
  const mayCreate = can(PROCUREMENT_PERMISSIONS.createRequest);

  const projectFilter = useProjectFilter();
  const [filters, setFilters] = useState<FilterValues>((): FilterValues =>
    projectFilter.initialProjectId ? { for: projectFilter.initialProjectId } : {},
  );
  const controls = useListControls();
  const requests = useMaterialRequests({
    ...(filters.status ? { status: filters.status as MaterialRequestStatus } : {}),
    ...(filters.for ? { requestedFor: filters.for } : {}),
    ...(controls.debouncedSearch ? { search: controls.debouncedSearch } : {}),
  });
  const projects = useProjects();
  const cancel = useCancelMaterialRequest();
  const [cancelling, setCancelling] = useState<MaterialRequest | null>(null);

  const rows = useMemo(() => requests.data ?? [], [requests.data]);
  const moneyVisible =
    rows.find((mr) => mr.moneyVisible !== undefined)?.moneyVisible ??
    can(PROCUREMENT_PERMISSIONS.viewCommitments);

  const projectName = (mr: MaterialRequest): string | null =>
    mr.project?.name ?? projects.data?.find((p) => p.id === mr.projectId)?.name ?? null;
  const forLabel = (mr: MaterialRequest) =>
    mr.requestScope === 'ORGANIZATION' ? tc('overhead') : (projectName(mr) ?? tc('notAvailable'));
  const titleOf = (mr: MaterialRequest) =>
    mr.title?.trim() || mr.description?.trim() || t('untitled', { count: mr.lines?.length ?? 0 });

  const columns: GridColumn<MaterialRequest>[] = [
    {
      key: 'request',
      header: t('columns.request'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (mr) => `${mr.mrNumber} ${titleOf(mr)}`,
      // The grid wraps this cell in the row's one link.
      render: (mr) => (
        <span className="block min-w-0">
          <span className="block font-semibold text-brand-primary">{mr.mrNumber}</span>
          <span className="block max-w-[20rem] truncate text-caption font-normal text-muted-foreground">
            {titleOf(mr)}
          </span>
        </span>
      ),
    },
    {
      key: 'for',
      header: t('columns.for'),
      sortable: true,
      card: 'subtitle',
      plainValue: (mr) => forLabel(mr),
      render: (mr) => (
        <span className="block min-w-0">
          <span className="block max-w-[16rem] truncate text-foreground">{forLabel(mr)}</span>
          {mr.requester?.name ? (
            <span className="block truncate text-caption text-muted-foreground">
              {t('requestedBy', { name: mr.requester.name })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'neededBy',
      header: t('columns.neededBy'),
      sortable: true,
      card: 'meta',
      plainValue: (mr) => mr.requiredByDate ?? '',
      render: (mr, ctx) => (
        <span className="block">
          <span className={mr.requiredByDate ? 'text-foreground' : 'text-muted-foreground'}>
            {formatDate(mr.requiredByDate, ctx.locale) ?? t('noDate')}
          </span>
          {mr.priority === 'URGENT' && OPEN_STATUSES.has(mr.status) ? (
            <span className="block text-caption font-medium text-warning">{t('urgent')}</span>
          ) : null}
        </span>
      ),
    },
  ];
  if (moneyVisible) {
    columns.push({
      key: 'estimate',
      header: t('columns.estimate'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (mr) => (mr.estimatedTotal == null ? null : Number(mr.estimatedTotal)),
      // Null is "nothing estimated" — never shown as $0.
      render: (mr) =>
        mr.estimatedTotal == null ? (
          <span className="text-muted-foreground">{tc('notAvailable')}</span>
        ) : (
          <span className="tabular-nums">{formatMoney(mr.estimatedTotal, mr.currencyCode ?? 'USD')}</span>
        ),
    });
  }
  columns.push({
    key: 'status',
    header: t('columns.status'),
    card: 'status',
    render: (mr) => <ProcurementStatusBadge vocabulary="materialRequest" status={mr.status} />,
  });

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filters.status'),
      options: STATUSES.map((value) => ({ value, label: tStatus(value) })),
    },
    {
      key: 'for',
      type: 'select',
      label: t('filters.requestedFor'),
      options: [{ value: OVERHEAD_FILTER, label: tc('overhead') }, ...projectFilter.options],
    },
  ];

  const isNarrowed = Boolean(controls.search) || Object.values(filters).some(Boolean);
  const view = controls.view(rows, columns);
  const isFirstUse = !isNarrowed && requests.data !== undefined && rows.length === 0;

  const createAction = mayCreate ? (
    <Button asChild>
      <Link href="/procurement/requests/new">
        <Plus className="size-4" aria-hidden="true" />
        {t('new')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-3">
      <PlatformDataGrid
        columns={columns}
        data={view.data}
        rowKey={(mr) => mr.id}
        label={tMr('title')}
        isLoading={requests.isPending}
        isError={requests.isError}
        errorMessage={tc('loadFailed')}
        onRetry={() => void requests.refetch()}
        rowHref={(mr) => `/procurement/requests/${mr.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        server={view.server}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={(next) => {
          setFilters(next);
          controls.resetPage();
        }}
        rowActions={(mr) => (
          <ListRowMenu
            label={tc('rowMenu', { number: mr.mrNumber })}
            openHref={`/procurement/requests/${mr.id}`}
            openLabel={tc('open')}
            commands={
              mayCreate && mr.status === 'DRAFT'
                ? [{ key: 'cancel', label: tMr('cancelRequest'), onSelect: () => setCancelling(mr) }]
                : []
            }
          />
        )}
        // First use only — a filter that empties the list gets the grid's filtered-empty state.
        emptyState={
          isFirstUse ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} action={createAction} />
          ) : undefined
        }
        toolbarActions={createAction}
      />
      {!moneyVisible && !requests.isPending && !requests.isError && !isFirstUse ? (
        <p className="text-caption text-muted-foreground">{t('moneyHidden')}</p>
      ) : null}

      {cancelling ? (
        <ConfirmActionDialog
          title={tMr('cancelTitle', { number: cancelling.mrNumber })}
          description={tMr('cancelBody')}
          confirmLabel={tMr('cancelRequest')}
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
