'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { Button, cn, EmptyState, type FilterValues, type ListFilterField } from '@erp/ui';
import type { SavedViewState } from '@erp/types';

import { ListPageHeader } from '@/components/layout/list-page-header';
import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { useProjectFilter } from '@/features/projects/hooks/use-project-filter';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { formatDate, formatMoney } from '@/lib/format';
import { MONEY_SCALE, fromMinorUnits } from '@/lib/money';

import { useJournals } from '../hooks/use-accounting';
import { todayWireDate } from '../invoice-overdue';
import { entryTotals } from '../journal-entry';
import type { JournalEntry, JournalStatus } from '../types';
import { JournalStatusBadge } from './journal-status-badge';

const STATUSES: JournalStatus[] = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'POSTED',
  'REJECTED',
  'REVERSED',
];
const DEFAULT_JOURNAL_SORT: SortState = { key: 'date', direction: 'desc' };

/** `GET /journals` returns every journal (it takes only `projectId`), so status filters here. */
function journalMatchesFilters(journal: JournalEntry, filters: FilterValues): boolean {
  return !filters.status || journal.status === filters.status;
}

export function JournalsList({
  projectId,
}: {
  /** ADR-043 Phase 2: fixes the list to journals with a line coded to this project. */
  projectId?: string;
} = {}) {
  const t = useTranslations('accounting.journals');
  const today = todayWireDate();

  // `?projectId=` lets a project link in already narrowed; applied server-side.
  const projectFilter = useProjectFilter();
  const view = useListViewState(
    DEFAULT_JOURNAL_SORT,
    projectFilter.initialProjectId ? { project: projectFilter.initialProjectId } : {},
  );
  const { filters } = view;
  const journals = useJournals({ projectId: projectId ?? (filters.project || undefined) });

  const all = useMemo(() => journals.data ?? [], [journals.data]);
  const visible = useMemo(
    () => all.filter((journal) => journalMatchesFilters(journal, filters)),
    [all, filters],
  );

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filterByStatus'),
      options: STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
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

  const columns: GridColumn<JournalEntry>[] = [
    {
      key: 'number',
      header: t('colNumber'),
      sticky: true,
      sortable: true,
      plainValue: (journal) => journal.journalNumber ?? '',
      exportValue: (journal) => journal.journalNumber ?? t('unnumbered'),
      render: (journal) => (
        <span
          className={cn(
            'text-body-sm font-semibold text-brand-primary',
            journal.journalNumber ? 'font-mono' : 'italic',
          )}
        >
          {journal.journalNumber ?? t('unnumbered')}
        </span>
      ),
    },
    {
      key: 'date',
      header: t('colDate'),
      sortable: true,
      plainValue: (journal) => journal.accountingDate,
      render: (journal, ctx) => (
        <span className="whitespace-nowrap">{formatDate(journal.accountingDate, ctx.locale)}</span>
      ),
    },
    {
      key: 'description',
      header: t('colDescription'),
      sortable: true,
      plainValue: (journal) => journal.description,
      render: (journal) => (
        <span className="block max-w-[24rem] truncate font-medium">{journal.description}</span>
      ),
    },
    {
      key: 'amount',
      header: t('colAmount'),
      numeric: true,
      sortable: true,
      plainValue: (journal) => Number(fromMinorUnits(entryTotals(journal).debitMinor, MONEY_SCALE)),
      render: (journal, ctx) => (
        <bdi className="font-semibold tabular-nums">
          {formatMoney(
            fromMinorUnits(entryTotals(journal).debitMinor, MONEY_SCALE),
            journal.currencyCode,
            ctx.locale,
          )}
        </bdi>
      ),
    },
    {
      key: 'status',
      header: t('colStatus'),
      plainValue: (journal) => t(`status.${journal.status}`),
      render: (journal) => <JournalStatusBadge status={journal.status} />,
    },
  ];

  const countFor = (viewState: SavedViewState): number | undefined => {
    const f = viewState.filters ?? {};
    if (!projectId && (f.project ?? '') !== (filters.project ?? '')) return undefined;
    return searchRows(
      all.filter((journal) => journalMatchesFilters(journal, f)),
      viewState.search ?? '',
      columns,
    ).length;
  };
  const byStatus = (id: string, status: JournalStatus): Omit<BuiltInView, 'count'> => ({
    id,
    label: t(`views.${id}`),
    state: { filters: { status }, sort: DEFAULT_JOURNAL_SORT },
  });
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_JOURNAL_SORT } },
    byStatus('drafts', 'DRAFT'),
    byStatus('toApprove', 'SUBMITTED'),
    byStatus('returned', 'REJECTED'),
    byStatus('posted', 'POSTED'),
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const createAction = (
    <Button asChild>
      <Link href="/finance/accounting/journals/new" data-shortcut-new="">
        <Plus size={16} aria-hidden="true" />
        {t('newJournal')}
        <kbd
          className="hidden rounded border border-white/40 px-1 font-mono text-micro md:inline"
          aria-hidden="true"
        >
          N
        </kbd>
      </Link>
    </Button>
  );

  const waiting = all.filter((journal) => journal.status === 'SUBMITTED').length;
  const headerSummary =
    all.length === 0 ? undefined : t('headerSummary', { count: all.length, waiting });

  const grid = (
    <PlatformDataGrid
      columns={columns}
      data={visible}
      rowKey={(journal) => journal.id}
      label={t('title')}
      isLoading={journals.isPending}
      isError={journals.isError}
      errorMessage={t('loadFailed')}
      onRetry={() => void journals.refetch()}
      rowHref={(journal) => `/finance/accounting/journals/${journal.id}`}
      emptyState={
        all.length === 0 && (projectId || !filters.project) ? (
          <EmptyState title={t('empty')} description={t('emptyHint')} action={createAction} />
        ) : undefined
      }
      noMatchMessage={t('noMatches')}
      resultLabel={(count) => t('countLabel', { count })}
      pagination={{ defaultPageSize: 25 }}
      listState={view.listState}
      savedViews={
        <ListViewsBar
          listKey={projectId ? 'project-journals' : 'journals'}
          builtIns={builtIns}
          current={view.current}
          onApply={view.applyView}
          countFor={countFor}
          label={t('views.label')}
        />
      }
      exportAs={{ fileName: `journals-${today}`, sheetName: t('title') }}
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
