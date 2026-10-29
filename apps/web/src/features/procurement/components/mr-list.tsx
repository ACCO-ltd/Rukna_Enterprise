'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, type FilterValues, type ListFilterField } from '@erp/ui';
import { ClipboardList, Plus } from 'lucide-react';
import type { SavedViewState } from '@erp/types';

import { ConfirmActionDialog } from '@/components/confirm-action-dialog';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { PlatformDataGrid, type GridColumn, type SortState } from '@/components/platform-data-grid';
import { PROCUREMENT_PERMISSIONS, usePermissions } from '@/features/auth/permissions/can';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { formatDate, formatMoney } from '@/lib/format';

import { useCancelMaterialRequest, useMaterialRequests } from '../hooks/use-procurement';
import type { MaterialRequest, MaterialRequestStatus } from '../types';
import { ListRowMenu, errorText } from './list-row-menu';
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

const DEFAULT_SORT: SortState = { key: 'request', direction: 'desc' };

/** The "Requested for" filter's overhead choice. */
export const OVERHEAD_FILTER = 'overhead';

/** Whether a request passes the list's filters (the search ran on the server). */
export function mrMatchesFilters(mr: MaterialRequest, filters: FilterValues): boolean {
  if (filters.status && mr.status !== filters.status) return false;
  if (filters.for === OVERHEAD_FILTER && mr.requestScope !== 'ORGANIZATION') return false;
  if (filters.for && filters.for !== OVERHEAD_FILTER && mr.projectId !== filters.for) return false;
  if (filters.urgent === 'open' && !(mr.priority === 'URGENT' && OPEN_STATUSES.has(mr.status)))
    return false;
  return true;
}

/**
 * Material request list (ADR-047 list page: title block, views, groups, export).
 *
 * The search runs on the server (`search` matches line descriptions the columns do not show);
 * filters, views, sort, groups, paging and export run on the returned set. The estimate is the server's
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
  const view = useListViewState(
    DEFAULT_SORT,
    projectFilter.initialProjectId ? { for: projectFilter.initialProjectId } : {},
    { searchOnServer: true },
  );
  const { filters } = view;
  const requests = useMaterialRequests(
    view.debouncedSearch ? { search: view.debouncedSearch } : undefined,
  );
  const projects = useProjects();
  const cancel = useCancelMaterialRequest();
  const [cancelling, setCancelling] = useState<MaterialRequest | null>(null);

  const all = useMemo(() => requests.data ?? [], [requests.data]);
  const visible = useMemo(() => all.filter((mr) => mrMatchesFilters(mr, filters)), [all, filters]);
  const moneyVisible =
    all.find((mr) => mr.moneyVisible !== undefined)?.moneyVisible ??
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
          <span className="tabular-nums">
            {formatMoney(mr.estimatedTotal, mr.currencyCode ?? 'USD')}
          </span>
        ),
    });
  }
  columns.push({
    key: 'status',
    header: t('columns.status'),
    card: 'status',
    plainValue: (mr) => tStatus(mr.status),
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
    {
      key: 'urgent',
      type: 'select',
      label: t('filters.urgent'),
      options: [{ value: 'open', label: t('filters.urgentOpen') }],
    },
  ];

  // Views (Step 8, ADR-047). The search ran on the server, so a view's count is shown only while
  // its search is the one the rows were fetched with.
  const countFor = (state: SavedViewState): number | undefined =>
    (state.search ?? '').trim() === view.search.trim()
      ? all.filter((mr) => mrMatchesFilters(mr, state.filters ?? {})).length
      : undefined;
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_SORT } },
    {
      id: 'toApprove',
      label: t('views.toApprove'),
      state: { filters: { status: 'SUBMITTED' }, sort: DEFAULT_SORT },
    },
    {
      id: 'toOrder',
      label: t('views.toOrder'),
      state: { filters: { status: 'APPROVED' }, sort: DEFAULT_SORT },
    },
    {
      id: 'urgent',
      label: t('views.urgent'),
      state: { filters: { urgent: 'open' }, sort: { key: 'neededBy', direction: 'asc' } },
    },
    {
      id: 'drafts',
      label: t('views.drafts'),
      state: { filters: { status: 'DRAFT' }, sort: DEFAULT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const isNarrowed = Boolean(view.search.trim()) || Object.values(filters).some(Boolean);
  const isFirstUse = !isNarrowed && requests.data !== undefined && all.length === 0;
  const openCount = all.filter((mr) => OPEN_STATUSES.has(mr.status)).length;
  const headerSummary =
    all.length === 0 || view.search.trim()
      ? undefined
      : t('headerSummary', { count: all.length, open: openCount });

  const createAction = mayCreate ? (
    <Button asChild>
      <Link href="/procurement/requests/new" data-shortcut-new="">
        <Plus className="size-4" aria-hidden="true" />
        {t('new')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={tMr('title')}
        summary={headerSummary}
        actions={createAction}
      />
      <PlatformDataGrid
        columns={columns}
        data={visible}
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
        pagination={{ defaultPageSize: 25 }}
        columnVisibility
        listState={view.listState}
        savedViews={
          <ListViewsBar
            listKey="material-requests"
            builtIns={builtIns}
            current={view.current}
            onApply={view.applyView}
            countFor={countFor}
            label={t('views.label')}
          />
        }
        groupOptions={[
          {
            key: 'for',
            label: t('groupFor'),
            groupOf: (mr) => ({ id: mr.projectId ?? OVERHEAD_FILTER, label: forLabel(mr) }),
          },
          {
            key: 'status',
            label: t('groupStatus'),
            groupOf: (mr) => ({ id: mr.status, label: tStatus(mr.status) }),
          },
        ]}
        exportAs={{ fileName: `material-requests-${todayWireDate()}`, sheetName: tMr('title') }}
        shortcuts={{
          onNew: mayCreate
            ? () => document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click()
            : undefined,
        }}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={view.setFilters}
        rowActions={(mr) => (
          <ListRowMenu
            label={tc('rowMenu', { number: mr.mrNumber })}
            openHref={`/procurement/requests/${mr.id}`}
            openLabel={tc('open')}
            commands={
              mayCreate && mr.status === 'DRAFT'
                ? [
                    {
                      key: 'cancel',
                      label: tMr('cancelRequest'),
                      onSelect: () => setCancelling(mr),
                    },
                  ]
                : []
            }
          />
        )}
        // First use only — a filter that empties the list gets the grid's filtered-empty state.
        emptyState={
          isFirstUse ? (
            <EmptyState
              icon={<ClipboardList size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
              action={createAction}
            />
          ) : undefined
        }
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
