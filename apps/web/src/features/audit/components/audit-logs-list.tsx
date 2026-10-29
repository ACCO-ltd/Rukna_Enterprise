'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Avatar, Button, EmptyState, type FilterValues, type ListFilterField, useToast } from '@erp/ui';
import { Download, ScrollText } from 'lucide-react';
import type { AuditLogQuery, AuditLogView } from '@erp/types';

import { exportCsv } from '@/features/accounting/lib/export-csv';
import { ListPageHeader } from '@/components/layout/list-page-header';
import { PlatformDataGrid, type GridColumn, type SortState } from '@/components/platform-data-grid';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { formatDateTime } from '@/lib/format';

import { listAuditLogs } from '../api/audit-api';
import { useAuditLogs } from '../hooks/use-audit-logs';

const DEFAULT_PAGE_SIZE = 50;
/** An export reads the filtered trail a page of 100 at a time, up to this many rows. */
const EXPORT_LIMIT = 5000;

/**
 * Administration → Audit logs (ADR-047 list page). The trail can be long, so search, filters and
 * paging run on the server (`GET /audit-logs`); each entry names the person who acted. Export
 * reads the whole filtered trail (up to 5,000 entries), not just the page on screen.
 */
export function AuditLogsList() {
  const t = useTranslations('platform.auditLogs');
  const locale = useLocale() as 'en' | 'ar';
  const { toast } = useToast();
  const view = useListViewState(null, {}, { searchOnServer: true });
  const { filters } = view;
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const [exporting, setExporting] = useState(false);

  const query: AuditLogQuery = {
    search: view.debouncedSearch,
    resource: filters.resource || undefined,
    userId: filters.user || undefined,
    from: filters.from || undefined,
    to: filters.to || undefined,
  };
  const logs = useAuditLogs({ ...query, page, pageSize });
  const data = logs.data;

  const columns: GridColumn<AuditLogView>[] = [
    {
      key: 'time',
      header: t('colTime'),
      card: 'meta',
      plainValue: (entry) => entry.createdAt,
      render: (entry) => (
        <span className="whitespace-nowrap text-muted-foreground tabular-nums">
          {formatDateTime(entry.createdAt, locale) ?? entry.createdAt}
        </span>
      ),
    },
    {
      key: 'user',
      header: t('colUser'),
      card: 'title',
      plainValue: (entry) => entry.user?.name ?? t('unknownUser'),
      render: (entry) =>
        entry.user ? (
          <span className="flex items-center gap-2.5">
            <Avatar name={entry.user.name} size="sm" />
            <span className="min-w-0">
              <span className="block max-w-[14rem] truncate font-medium">{entry.user.name}</span>
              <span className="block max-w-[14rem] truncate text-caption text-muted-foreground">{entry.user.email}</span>
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('unknownUser')}</span>
        ),
    },
    {
      key: 'action',
      header: t('colAction'),
      card: 'status',
      plainValue: (entry) => entry.action,
      render: (entry) => (
        <span className="block">
          <span className="font-mono text-caption uppercase">{entry.action}</span>
          {entry.reason ? (
            <span className="block max-w-[20rem] truncate text-caption text-muted-foreground">
              {t('reason', { reason: entry.reason })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'resource',
      header: t('colResource'),
      card: 'subtitle',
      plainValue: (entry) => `${entry.resource} ${entry.resourceId}`,
      render: (entry) => (
        <span className="block">
          <span className="font-mono text-caption">{entry.resource}</span>
          <span className="block font-mono text-caption text-muted-foreground">{entry.resourceId}</span>
        </span>
      ),
    },
  ];

  const filterFields: ListFilterField[] = [
    {
      key: 'resource',
      type: 'select',
      label: t('colResource'),
      options: (data?.facets.resources ?? []).map((value) => ({ value, label: value })),
    },
    {
      key: 'user',
      type: 'select',
      label: t('colUser'),
      options: (data?.facets.users ?? []).map((u) => ({ value: u.id, label: u.name })),
    },
    { key: 'from', type: 'date', label: t('filterFrom') },
    { key: 'to', type: 'date', label: t('filterTo') },
  ];

  async function exportTrail() {
    setExporting(true);
    try {
      const rows: AuditLogView[] = [];
      for (let p = 1; rows.length < EXPORT_LIMIT; p += 1) {
        const next = await listAuditLogs({ ...query, page: p, pageSize: 100 });
        rows.push(...next.items);
        if (rows.length >= next.total || next.items.length === 0) break;
      }
      exportCsv(
        `audit-log-${new Date().toISOString().slice(0, 10)}.csv`,
        [t('colTime'), t('colUser'), t('colEmail'), t('colAction'), t('colReason'), t('colResource'), t('colRecord'), t('colIp')],
        rows.map((e) => [e.createdAt, e.user?.name ?? '', e.user?.email ?? '', e.action, e.reason ?? '', e.resource, e.resourceId, e.ipAddress ?? '']),
      );
      if (data && data.total > EXPORT_LIMIT) {
        toast({ tone: 'info', title: t('exportCapped', { limit: EXPORT_LIMIT, total: data.total }) });
      }
    } catch {
      toast({ tone: 'error', title: t('exportFailed') });
    } finally {
      setExporting(false);
    }
  }

  const isNarrowed = Boolean(view.search.trim()) || Object.values(filters).some(Boolean);
  const isFirstUse = !isNarrowed && data !== undefined && data.total === 0;
  const resetPage = () => setPage(1);
  const sort: SortState | null = null;

  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={data && !isNarrowed ? t('headerSummary', { count: data.total }) : t('subtitle')}
      />
      <PlatformDataGrid
        columns={columns}
        data={data?.items ?? []}
        rowKey={(entry) => entry.id}
        label={t('title')}
        isLoading={logs.isPending}
        isError={logs.isError}
        onRetry={() => void logs.refetch()}
        errorMessage={t('loadFailed')}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        sortControl={false}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={(next: FilterValues) => {
          view.setFilters(next);
          resetPage();
        }}
        server={{
          search: view.search,
          onSearchChange: (next) => {
            view.listState.onSearchChange(next);
            resetPage();
          },
          sort,
          onSortChange: () => undefined,
          page,
          pageSize,
          total: data?.total ?? 0,
          onPageChange: setPage,
          onPageSizeChange: (next) => {
            setPageSize(next);
            resetPage();
          },
        }}
        toolbarActions={
          data && data.total > 0 ? (
            <Button type="button" variant="outline" loading={exporting} onClick={() => void exportTrail()}>
              <Download className="size-4" aria-hidden="true" />
              {t('export')}
            </Button>
          ) : undefined
        }
        emptyState={
          isFirstUse ? (
            <EmptyState icon={<ScrollText size={20} aria-hidden="true" />} title={t('empty')} description={t('emptyHint')} />
          ) : undefined
        }
      />
    </div>
  );
}
