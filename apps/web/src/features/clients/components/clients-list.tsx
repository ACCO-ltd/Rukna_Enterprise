'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  OverflowGlyph,
  RowActions,
  type FilterValues,
  type ListFilterField,
} from '@erp/ui';
import { Plus } from 'lucide-react';

import { PlatformDataGrid, type GridColumn, type SortState } from '@/components/platform-data-grid';
import { usePermissions } from '@/features/auth/permissions/can';
import { formatMoney } from '@/lib/format';
import { formatPhone } from '@/lib/phone';

import { useClientSummaries } from '../hooks/use-clients';
import {
  CLIENT_STATUS_ORDER,
  CLIENT_TYPES,
  ClientStatus,
  type ClientBalanceFilter,
  type ClientSummaryItem,
  type ClientSummaryQuery,
  type ClientSummarySort,
  type ClientType,
} from '../types';
import { ClientStatusBadge } from './client-status-badge';

type ListT = ReturnType<typeof useTranslations<'platform.clients'>>;

const MONEY_PERMISSION = 'view:financial-position';
const DEFAULT_PAGE_SIZE = 25;
const SEARCH_DEBOUNCE_MS = 300;

/** Grid sort → the API's `sort` param. Only name and outstanding sort server-side. */
export function toServerSort(sort: SortState | null): ClientSummarySort | undefined {
  if (!sort) return undefined;
  const key = sort.key === 'client' ? 'name' : sort.key === 'outstanding' ? 'outstanding' : null;
  if (!key) return undefined;
  return sort.direction === 'desc' ? `-${key}` : key;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function buildColumns(t: ListT, tTypes: (key: ClientType) => string, moneyVisible: boolean): GridColumn<ClientSummaryItem>[] {
  const columns: GridColumn<ClientSummaryItem>[] = [
    {
      key: 'client',
      header: t('columns.client'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (client) => client.name,
      // The grid wraps this cell in the row's one link; nothing else in the row links here.
      render: (client) => (
        <span className="min-w-0">
          <span className="block truncate font-medium text-foreground">{client.name}</span>
          <span className="block truncate text-caption text-muted-foreground">
            <span className="font-mono">{client.code}</span>
            {' · '}
            {tTypes(client.type)}
          </span>
        </span>
      ),
    },
    {
      key: 'contact',
      header: t('columns.contact'),
      card: 'subtitle',
      render: (client) =>
        client.primaryContact ? (
          <div className="min-w-0">
            <p className="truncate text-foreground">{client.primaryContact.name}</p>
            {client.primaryContact.phone ? (
              <p className="mt-0.5 text-caption tabular-nums text-muted-foreground" dir="ltr">
                {formatPhone(client.primaryContact.phone)}
              </p>
            ) : null}
          </div>
        ) : (
          <span className="text-muted-foreground">{t('noPrimaryContact')}</span>
        ),
    },
    {
      key: 'projects',
      header: t('columns.projects'),
      card: 'meta',
      render: (client) => <ProjectCounts client={client} t={t} />,
    },
  ];

  // Money-blind roles: the column is absent, not a column of "Restricted" (one note under the grid).
  if (moneyVisible) {
    columns.push({
      key: 'outstanding',
      header: t('columns.outstanding'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (client) => (client.outstanding === null ? null : Number(client.outstanding)),
      render: (client) => <OutstandingCell client={client} t={t} />,
    });
  }

  columns.push({
    key: 'status',
    header: t('columns.status'),
    card: 'status',
    render: (client) => <ClientStatusBadge status={client.status} />,
  });
  return columns;
}

function ProjectCounts({ client, t }: { client: ClientSummaryItem; t: ListT }) {
  if (client.totalProjectCount === 0) {
    return <span className="text-muted-foreground">{t('projects.noneYet')}</span>;
  }
  return (
    <div>
      <p className={client.activeProjectCount === 0 ? 'text-muted-foreground' : 'text-foreground'}>
        {client.activeProjectCount === 0
          ? t('projects.noneActive')
          : t('projects.active', { count: client.activeProjectCount })}
      </p>
      {client.totalProjectCount !== client.activeProjectCount ? (
        <p className="mt-0.5 text-caption text-muted-foreground">
          {t('projects.total', { count: client.totalProjectCount })}
        </p>
      ) : null}
    </div>
  );
}

function OutstandingCell({ client, t }: { client: ClientSummaryItem; t: ListT }) {
  // `null` only reaches here if the server withheld one row's money; show nothing rather than $0.
  if (client.outstanding === null) return <span className="text-muted-foreground">—</span>;
  const overdue = client.overdue !== null && Number(client.overdue) > 0 ? client.overdue : null;
  return (
    <div>
      <p className="font-medium tabular-nums text-foreground">{formatMoney(client.outstanding, 'USD')}</p>
      {overdue ? (
        <p className="mt-0.5 text-caption tabular-nums text-danger">
          {t('overdueAmount', { amount: formatMoney(overdue, 'USD') ?? '' })}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Clients list (clients redesign, 2026-10-02). Search, filters, sort and paging run on the
 * server (`GET /clients/summary`); the grid draws the controls and reports changes.
 *
 * Money follows the one gate, `view:financial-position`: without it the Outstanding column and
 * the Balance filter are absent and one line under the grid says why — a hidden figure is never
 * shown as $0.
 */
export function ClientsList() {
  const t = useTranslations('platform.clients');
  const tCreate = useTranslations('platform.clients.create');
  const { can } = usePermissions();
  const mayCreate = can('create:client');
  const mayEdit = can('manage:client');
  const mayCreateProject = can('create:project');

  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterValues>({});
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);

  const query: ClientSummaryQuery = {
    search: debouncedSearch || undefined,
    status: (filters.status || undefined) as ClientStatus | undefined,
    type: (filters.type || undefined) as ClientType | undefined,
    balance: (filters.balance || undefined) as ClientBalanceFilter | undefined,
    sort: toServerSort(sort),
    page,
    pageSize,
  };
  const summaries = useClientSummaries(query);
  const data = summaries.data;
  // Until the first page answers, the permission decides; after, the server's own verdict does.
  const moneyVisible = data?.moneyVisible ?? can(MONEY_PERMISSION);

  const tTypes = (key: ClientType) => tCreate(`clientTypes.${key}`);
  const columns = useMemo(() => buildColumns(t, (key) => tCreate(`clientTypes.${key}`), moneyVisible), [t, tCreate, moneyVisible]);

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filters.status'),
      anyLabel: t('allStatuses'),
      options: CLIENT_STATUS_ORDER.map((value) => ({ value, label: t(`status.${value}`) })),
    },
    {
      key: 'type',
      type: 'select',
      label: t('filters.type'),
      anyLabel: t('allTypes'),
      options: CLIENT_TYPES.map((value) => ({ value, label: tTypes(value) })),
    },
    ...(moneyVisible
      ? [
          {
            key: 'balance',
            type: 'select' as const,
            label: t('filters.balance'),
            anyLabel: t('filters.anyBalance'),
            options: [
              { value: 'OWES', label: t('filters.owes') },
              { value: 'OVERDUE', label: t('filters.overdue') },
            ],
          },
        ]
      : []),
  ];

  const isNarrowed = Boolean(search.trim() || Object.values(filters).some(Boolean));
  const isFirstUse = !isNarrowed && data !== undefined && data.total === 0;

  const createAction = mayCreate ? (
    <Button asChild>
      <Link href="/clients/new">
        <Plus className="size-4" aria-hidden="true" />
        {t('newClient')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-3">
      <PlatformDataGrid
        columns={columns}
        data={data?.items ?? []}
        rowKey={(client) => client.id}
        label={t('title')}
        isLoading={summaries.isPending}
        isError={summaries.isError}
        errorMessage={t('loadFailed')}
        retryLabel={t('retry')}
        onRetry={() => void summaries.refetch()}
        rowHref={(client) => `/clients/${client.id}`}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={(next) => {
          setFilters(next);
          setPage(1);
        }}
        server={{
          search,
          onSearchChange: (next) => {
            setSearch(next);
            setPage(1);
          },
          sort,
          onSortChange: (next) => {
            setSort(next);
            setPage(1);
          },
          page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: setPage,
          onPageSizeChange: (next) => {
            setPageSize(next);
            setPage(1);
          },
        }}
        rowActions={(client) => (
          <RowActions
            overflow={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" aria-label={t('rowMenu.label', { name: client.name })}>
                    <OverflowGlyph />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/clients/${client.id}`}>{t('rowMenu.open')}</Link>
                  </DropdownMenuItem>
                  {mayCreateProject && client.status === ClientStatus.ACTIVE ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/projects/new?clientId=${client.id}`}>{t('rowMenu.newProject')}</Link>
                    </DropdownMenuItem>
                  ) : null}
                  {mayEdit ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/clients/${client.id}/edit`}>{t('rowMenu.edit')}</Link>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        )}
        // First use only — a search or filter that empties the list gets the grid's
        // filtered-empty state with "Clear filters" instead.
        emptyState={
          isFirstUse ? (
            <EmptyState title={t('empty')} description={t('emptyHint')} action={createAction} />
          ) : undefined
        }
        toolbarActions={createAction}
      />
      {!moneyVisible && !summaries.isPending && !summaries.isError && !isFirstUse ? (
        <p className="text-caption text-muted-foreground">{t('moneyHidden')}</p>
      ) : null}
    </div>
  );
}
