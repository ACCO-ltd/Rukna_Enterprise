'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { ProjectStatus } from '@erp/types';
import { Alert, Button, Input, Label, Select } from '@erp/ui';

import { formatDate, formatMoney } from '@/lib/format';

import { filterProjects } from '../filter-projects';
import { useProjects } from '../hooks/use-projects';
import { PROJECT_STATUS_ORDER, type Project } from '../types';
import { ProjectStatusBadge } from './project-status-badge';

export function ProjectsList() {
  const t = useTranslations('platform.projects');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch, isFetching } = useProjects();

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProjectStatus | 'ALL'>('ALL');

  const visible = useMemo(
    () => filterProjects(data ?? [], { search, status }),
    [data, search, status],
  );

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetch();
            }}
            disabled={isFetching}
          >
            {t('retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  // No projects at all is a different situation from no projects matching a filter, and
  // the two need different wording and different escape routes.
  if (data.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t('empty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
        <div className="mt-4">
          <Button asChild>
            <Link href="/projects/new">{t('newProject')}</Link>
          </Button>
        </div>
      </div>
    );
  }

  const hasFilters = search.trim() !== '' || status !== 'ALL';

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div>
          <Label htmlFor="project-search" className="sr-only">
            {t('searchLabel')}
          </Label>
          <Input
            id="project-search"
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
          />
        </div>

        <div>
          <Label htmlFor="project-status" className="sr-only">
            {t('filterByStatus')}
          </Label>
          <Select
            id="project-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as ProjectStatus | 'ALL');
            }}
          >
            <option value="ALL">{t('allStatuses')}</option>
            {PROJECT_STATUS_ORDER.map((value) => (
              <option key={value} value={value}>
                {t(`status.${value}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {/* Announced politely so filtering feedback reaches screen readers without
          interrupting typing. */}
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t('countLabel', { count: visible.length })}
      </p>

      {visible.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t('noMatches')}</p>
          {hasFilters ? (
            <div className="mt-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch('');
                  setStatus('ALL');
                }}
              >
                {t('clearFilters')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
          {visible.map((project) => (
            <ProjectRow key={project.id} project={project} locale={locale} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ProjectRow({ project, locale }: { project: Project; locale: 'en' | 'ar' }) {
  const t = useTranslations('platform.projects');

  const displayName = locale === 'ar' && project.nameAr ? project.nameAr : project.name;
  const value = formatMoney(project.contractValue, project.currency, locale);
  const start = formatDate(project.startDate, locale);

  return (
    <li>
      <Link
        href={`/projects/${project.id}`}
        className="flex min-h-16 flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary sm:flex-row sm:items-center sm:gap-4"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
            <ProjectStatusBadge status={project.status} />
          </div>
          <p className="mt-1 truncate text-sm font-medium text-foreground">{displayName}</p>
          {project.clientName ? (
            <p className="truncate text-xs text-muted-foreground">{project.clientName}</p>
          ) : null}
        </div>

        <div className="flex items-baseline gap-3 sm:flex-col sm:items-end sm:gap-0.5">
          <span className="text-sm font-semibold text-foreground">
            {value ?? (
              <span className="font-normal text-muted-foreground">{t('noContractValue')}</span>
            )}
          </span>
          {start ? <span className="text-xs text-muted-foreground">{start}</span> : null}
        </div>
      </Link>
    </li>
  );
}
