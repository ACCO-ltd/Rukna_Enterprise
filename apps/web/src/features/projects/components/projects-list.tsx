'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ProjectCategory, ProjectStatus, type SavedViewState } from '@erp/types';
import {
  Avatar,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  entityTintClass,
  type FilterValues,
  type ListFilterField,
  OverflowGlyph,
  RowActions,
} from '@erp/ui';
import { CalendarDays, FolderOpen, Plus } from 'lucide-react';

import { ListPageHeader } from '@/components/layout/list-page-header';
import {
  PlatformDataGrid,
  searchRows,
  type GridColumn,
  type SortState,
} from '@/components/platform-data-grid';
import { RecordTile } from '@/components/record-tile';
import { ListViewsBar, type BuiltInView } from '@/features/saved-views/components/list-views-bar';
import { useListViewState } from '@/features/saved-views/hooks/use-list-view-state';
import { todayWireDate } from '@/features/accounting/invoice-overdue';
import { formatDate, formatMoney } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { ProjectCategoryBadge } from '@/features/project-types/components/project-category-badge';

import { PROJECT_PERMISSIONS } from '../permissions';
import { useProjects } from '../hooks/use-projects';
import { PROJECT_STATUS_ORDER, type Project } from '../types';
import { ProjectStatusBadge } from './project-status-badge';

function programme(project: Project, locale: 'en' | 'ar', notSet: string) {
  const start = formatDate(project.startDate, locale);
  const end = formatDate(project.expectedEndDate, locale);
  if (!start && !end) return notSet;
  return [start ?? notSet, end ?? notSet].join(' - ');
}

function buildColumns(
  t: ReturnType<typeof useTranslations<'platform.projects'>>,
  tTypes: ReturnType<typeof useTranslations<'projectTypes'>>,
  locale: 'en' | 'ar',
  canViewFinancials: boolean,
): GridColumn<Project>[] {
  return [
    {
      key: 'project',
      header: t('columns.project'),
      sticky: true,
      sortable: true,
      card: 'title',
      plainValue: (project) =>
        [project.name, project.code, project.clientName].filter(Boolean).join(' '),
      exportValue: (project) => project.name,
      render: (project) => (
        <div className="flex items-center gap-3">
          <RecordTile />
          <span className="min-w-0">
            <span className="block max-w-[18rem] truncate font-semibold text-foreground">
              {project.name}
            </span>
            <span className="mt-0.5 block truncate font-mono text-caption text-muted-foreground">
              {project.code}
            </span>
          </span>
        </div>
      ),
    },
    {
      key: 'client',
      header: t('columns.client'),
      sortable: true,
      card: 'subtitle',
      plainValue: (project) => project.clientName ?? '',
      render: (project) =>
        project.clientName ? (
          <span className="flex items-center gap-2.5">
            <Avatar
              name={project.clientName}
              size="sm"
              className={cn(
                'rounded-control ring-0',
                entityTintClass(project.clientId ?? project.clientName),
              )}
            />
            <span className="block max-w-[14rem] truncate font-medium">{project.clientName}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">{t('notSet')}</span>
        ),
    },
    {
      key: 'stage',
      header: t('columns.stage'),
      card: 'status',
      plainValue: (project) => t(`status.${project.status}`),
      render: (project) => <ProjectStatusBadge status={project.status} />,
    },
    {
      key: 'category',
      header: tTypes('display.categoryLabel'),
      plainValue: (project) =>
        project.category ? tTypes(`categories.${project.category}`) : tTypes('display.untyped'),
      render: (project) => <ProjectCategoryBadge category={project.category} />,
    },
    {
      key: 'manager',
      header: t('columns.manager'),
      sortable: true,
      plainValue: (project) => project.projectManager ?? '',
      render: (project) => (
        <span className="text-sm text-foreground">
          {project.projectManager ?? t('notAssigned')}
        </span>
      ),
    },
    {
      key: 'programme',
      header: t('columns.programme'),
      plainValue: (project) => project.expectedEndDate ?? project.startDate ?? '',
      render: (project) => (
        <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          {programme(project, locale, t('notSet'))}
        </span>
      ),
    },
    {
      key: 'contractValue',
      header: t('columns.contractValue'),
      numeric: true,
      sortable: true,
      card: 'amount',
      plainValue: (project) => (project.contractValue ? Number(project.contractValue) : null),
      render: (project) => (
        <span className="whitespace-nowrap font-medium tabular-nums">
          {formatMoney(project.contractValue, project.currency, locale) ??
            t(canViewFinancials ? 'notSet' : 'restricted')}
        </span>
      ),
    },
  ];
}

const DEFAULT_SORT: SortState = { key: 'project', direction: 'asc' };
const CATEGORY_VALUES = [...Object.values(ProjectCategory), 'UNTYPED'] as const;

/** Whether a project passes the list's filters ('UNTYPED' = a legacy project with no category). */
export function projectMatchesFilters(project: Project, filters: FilterValues): boolean {
  if (filters.status && project.status !== filters.status) return false;
  if (filters.category === 'UNTYPED' && project.category) return false;
  if (filters.category && filters.category !== 'UNTYPED' && project.category !== filters.category)
    return false;
  if (filters.client && project.clientId !== filters.client) return false;
  return true;
}

/**
 * The project list (ADR-047 list page: title block, views, groups, export). `GET /projects` has
 * no search or paging (B8) and the whole list is cached for the dashboard, so everything runs in
 * the browser; past a few hundred projects it needs to move server-side.
 */
export function ProjectsList() {
  const t = useTranslations('platform.projects');
  const tTypes = useTranslations('projectTypes');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch } = useProjects();
  const { can } = usePermissions();
  const canViewFinancials = can('view:financial-position');
  const mayCreate = can('create:project');
  const canManage = can(PROJECT_PERMISSIONS.manage);
  const view = useListViewState(DEFAULT_SORT);
  const { filters } = view;
  const all = useMemo(() => data ?? [], [data]);
  const visible = useMemo(
    () => all.filter((project) => projectMatchesFilters(project, filters)),
    [all, filters],
  );
  const columns = useMemo(
    () => buildColumns(t, tTypes, locale, canViewFinancials),
    [t, tTypes, locale, canViewFinancials],
  );

  // Client options are the clients that have projects — never an option that can only empty the list.
  const clientOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const p of all)
      if (p.clientId && p.clientName && !seen.has(p.clientId)) seen.set(p.clientId, p.clientName);
    return [...seen]
      .map(([value, label]) => ({ value, label }))
      .sort((x, y) => x.label.localeCompare(y.label));
  }, [all]);

  const filterFields: ListFilterField[] = [
    {
      key: 'status',
      type: 'select',
      label: t('filterByStatus'),
      options: PROJECT_STATUS_ORDER.map((value) => ({ value, label: t(`status.${value}`) })),
    },
    {
      key: 'category',
      type: 'select',
      label: tTypes('display.filterByCategory'),
      options: CATEGORY_VALUES.map((value) => ({
        value,
        label: value === 'UNTYPED' ? tTypes('display.untyped') : tTypes(`categories.${value}`),
      })),
    },
    { key: 'client', type: 'select', label: t('columns.client'), options: clientOptions },
  ];

  const countFor = (state: SavedViewState): number =>
    searchRows(
      all.filter((p) => projectMatchesFilters(p, state.filters ?? {})),
      state.search ?? '',
      columns,
    ).length;
  const builtInViews: Omit<BuiltInView, 'count'>[] = [
    { id: 'all', label: t('views.all'), state: { sort: DEFAULT_SORT } },
    {
      id: 'active',
      label: t('views.active'),
      state: { filters: { status: ProjectStatus.ACTIVE }, sort: DEFAULT_SORT },
    },
    {
      id: 'completion',
      label: t('views.completion'),
      state: { filters: { status: ProjectStatus.PRACTICAL_COMPLETION }, sort: DEFAULT_SORT },
    },
    {
      id: 'drafts',
      label: t('views.drafts'),
      state: { filters: { status: ProjectStatus.DRAFT }, sort: DEFAULT_SORT },
    },
  ];
  const builtIns: BuiltInView[] = builtInViews.map((v) => ({ ...v, count: countFor(v.state) }));

  const activeCount = all.filter((p) => p.status === ProjectStatus.ACTIVE).length;
  const headerSummary =
    all.length === 0 ? undefined : t('headerSummary', { count: all.length, active: activeCount });

  const createAction = mayCreate ? (
    <Button asChild>
      <Link href="/projects/new" data-shortcut-new="">
        <Plus className="size-4" aria-hidden="true" />
        {t('newProject')}
      </Link>
    </Button>
  ) : undefined;

  return (
    <div className="space-y-5">
      <ListPageHeader
        eyebrow={t('eyebrow')}
        title={t('title')}
        summary={headerSummary}
        actions={createAction}
      />
      <PlatformDataGrid
        columns={columns}
        data={visible}
        rowKey={(project) => project.id}
        label={t('title')}
        isLoading={isPending}
        isError={isError}
        onRetry={() => void refetch()}
        errorMessage={t('loadFailed')}
        retryLabel={t('retry')}
        searchLabel={t('searchLabel')}
        searchPlaceholder={t('searchPlaceholder')}
        resultLabel={(count) => t('countLabel', { count })}
        noMatchMessage={t('noMatches')}
        emptyState={
          all.length === 0 ? (
            <EmptyState
              icon={<FolderOpen size={20} aria-hidden="true" />}
              title={t('empty')}
              description={t('emptyHint')}
              action={createAction}
            />
          ) : undefined
        }
        pagination={{ defaultPageSize: 25 }}
        columnVisibility
        listState={view.listState}
        savedViews={
          <ListViewsBar
            listKey="projects"
            builtIns={builtIns}
            current={view.current}
            onApply={view.applyView}
            countFor={countFor}
            label={t('views.label')}
          />
        }
        groupOptions={[
          {
            key: 'stage',
            label: t('columns.stage'),
            groupOf: (p) => ({ id: p.status, label: t(`status.${p.status}`) }),
          },
          {
            key: 'client',
            label: t('columns.client'),
            groupOf: (p) => ({ id: p.clientId ?? '', label: p.clientName ?? t('notSet') }),
          },
          {
            key: 'manager',
            label: t('columns.manager'),
            groupOf: (p) => ({
              id: p.projectManager ?? '',
              label: p.projectManager ?? t('notAssigned'),
            }),
          },
        ]}
        exportAs={{ fileName: `projects-${todayWireDate()}`, sheetName: t('title') }}
        shortcuts={{
          onNew: mayCreate
            ? () => document.querySelector<HTMLAnchorElement>('a[data-shortcut-new]')?.click()
            : undefined,
        }}
        filters={filterFields}
        filterValues={filters}
        onFilterValuesChange={view.setFilters}
        rowHref={(project) => `/projects/${project.id}`}
        rowActions={(project) => (
          <RowActions
            overflow={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t('rowMenu.label', { name: project.name })}
                  >
                    <OverflowGlyph />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem asChild>
                    <Link href={`/projects/${project.id}`}>{t('rowMenu.view')}</Link>
                  </DropdownMenuItem>
                  {/* The same gate the record page uses (`project-detail.tsx`): editing a
                      project is a DRAFT-only command, and it is `manage:project` that grants it. */}
                  {project.status === ProjectStatus.DRAFT && canManage ? (
                    <DropdownMenuItem asChild>
                      <Link href={`/projects/${project.id}/edit`}>{t('rowMenu.edit')}</Link>
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            }
          />
        )}
      />
    </div>
  );
}
