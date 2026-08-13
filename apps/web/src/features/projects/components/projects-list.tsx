'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ProjectStatus } from '@erp/types';
import { Button, Label, Select } from '@erp/ui';
import { AlertTriangle, CalendarDays, Filter, Plus } from 'lucide-react';

import { EmptyState } from '@/components/empty-state';
import { PlatformDataGrid, type GridColumn } from '@/components/platform-data-grid';
import { formatDate, formatMoney } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';

import { filterProjects } from '../filter-projects';
import { useProjects } from '../hooks/use-projects';
import { PROJECT_STATUS_ORDER, type Project } from '../types';
import { ProjectStatusBadge } from './project-status-badge';

function programme(project: Project, locale: 'en' | 'ar', notSet: string) {
  const start = formatDate(project.startDate, locale);
  const end = formatDate(project.expectedEndDate, locale);
  if (!start && !end) return notSet;
  return [start ?? notSet, end ?? notSet].join(' - ');
}

function attention(project: Project, t: ReturnType<typeof useTranslations<'platform.projects'>>) {
  if (project.isSuspended) return { label: t('attention.suspended'), urgent: true };
  if (
    project.expectedEndDate &&
    new Date(project.expectedEndDate) < new Date() &&
    ![ProjectStatus.CLOSED, ProjectStatus.CANCELLED].includes(project.status)
  ) return { label: t('attention.overdue'), urgent: true };
  if (project.status === ProjectStatus.DRAFT) return { label: t('attention.setup'), urgent: false };
  return { label: t('attention.clear'), urgent: false };
}

function buildColumns(
  t: ReturnType<typeof useTranslations<'platform.projects'>>,
  locale: 'en' | 'ar',
): GridColumn<Project>[] {
  return [
    {
      key: 'project',
      header: t('columns.project'),
      sticky: true,
      sortable: true,
      plainValue: (project) => [project.name, project.code, project.clientName].filter(Boolean).join(' '),
      render: (project) => (
        <Link href={`/projects/${project.id}`} className="group -my-2 flex min-h-12 flex-col justify-center focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary">
          <span className="font-semibold text-foreground transition-colors group-hover:text-brand-primary">{locale === 'ar' && project.nameAr ? project.nameAr : project.name}</span>
          <span className="mt-0.5 text-xs text-muted-foreground">{project.clientName ?? project.code}</span>
        </Link>
      ),
    },
    { key: 'stage', header: t('columns.stage'), render: (project) => <ProjectStatusBadge status={project.status} /> },
    {
      key: 'manager',
      header: t('columns.manager'),
      sortable: true,
      plainValue: (project) => project.projectManager ?? '',
      render: (project) => <span className="text-sm text-foreground">{project.projectManager ?? t('notAssigned')}</span>,
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
      plainValue: (project) => project.contractValue ? Number(project.contractValue) : null,
      render: (project) => <span className="whitespace-nowrap font-medium tabular-nums">{formatMoney(project.contractValue, project.currency, locale) ?? t('restrictedOrNotSet')}</span>,
    },
    {
      key: 'attention',
      header: t('columns.attention'),
      render: (project) => {
        const state = attention(project, t);
        return (
          <span className={state.urgent ? 'inline-flex items-center gap-1.5 text-sm font-medium text-warning-foreground' : 'text-sm text-muted-foreground'}>
            {state.urgent ? <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" /> : null}
            {state.label}
          </span>
        );
      },
    },
  ];
}

export function ProjectsList() {
  const t = useTranslations('platform.projects');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch } = useProjects();
  const { can } = usePermissions();
  const mayCreate = can('create:project');
  const [status, setStatus] = useState<ProjectStatus | 'ALL'>('ALL');
  const rows = useMemo(() => filterProjects(data ?? [], { search: '', status }), [data, status]);
  const columns = useMemo(() => buildColumns(t, locale), [t, locale]);

  const statusFilter = (
    <div className="relative min-w-44">
      <Label htmlFor="project-status" className="sr-only">{t('filterByStatus')}</Label>
      <Select id="project-status" value={status} className="ps-10" onChange={(event) => setStatus(event.target.value as ProjectStatus | 'ALL')}>
        <option value="ALL">{t('allStatuses')}</option>
        {PROJECT_STATUS_ORDER.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
      </Select>
      <Filter className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );

  return (
    <PlatformDataGrid
      columns={columns}
      data={rows}
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
      clearFiltersLabel={t('clearFilters')}
      emptyState={<EmptyState title={t('empty')} description={t('emptyHint')} action={mayCreate ? <Button asChild><Link href="/projects/new"><Plus className="me-2 h-4 w-4" aria-hidden="true" />{t('newProject')}</Link></Button> : undefined} />}
      toolbarLeft={statusFilter}
      toolbarRight={mayCreate ? <Button asChild><Link href="/projects/new"><Plus className="me-2 h-4 w-4" aria-hidden="true" />{t('newProject')}</Link></Button> : undefined}
    />
  );
}
