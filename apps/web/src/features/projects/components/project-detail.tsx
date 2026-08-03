'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useProject } from '../hooks/use-project';
import { getAvailableActions } from '../project-actions';
import type { ProjectDetail as ProjectDetailModel } from '../types';
import { ProjectActionsPanel } from './project-actions-panel';
import { ProjectStatusBadge } from './project-status-badge';

export function ProjectDetail({ id }: { id: string }) {
  const t = useTranslations('platform.projects.detail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const { data: project, isPending, isError, error } = useProject(id);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
      </div>
    );
  }

  if (isError) {
    // 404 and 403 both mean "not yours to see" from the user's point of view, and the
    // distinction is not worth leaking.
    const notFound =
      error instanceof ApiError && (error.status === 404 || error.status === 403);

    return (
      <div className="space-y-4">
        <Alert variant="error" messages={[notFound ? t('notFound') : t('loadFailed')]} />
        <Button variant="outline" asChild>
          <Link href="/projects">{t('backToList')}</Link>
        </Button>
      </div>
    );
  }

  const displayName = locale === 'ar' && project.nameAr ? project.nameAr : project.name;
  const suspension = project.suspensions.find((s) => s.resumedAt === null);
  const actions = getAvailableActions(project);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center text-sm font-medium text-brand-primary hover:text-brand-primary-hover"
        >
          {t('backToList')}
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
            <ProjectStatusBadge status={project.status} />
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-foreground">
            {displayName}
          </h1>
        </div>
      </div>

      {suspension ? (
        <Alert variant="warning" title={t('suspendedTitle')}>
          <p className="mt-1">{suspension.reason}</p>
          <p className="mt-2 text-xs">
            {t('suspendedSince', { date: formatDate(suspension.suspendedAt, locale) ?? '—' })}
            {actions.advanceBlockedBySuspension ? ` ${t('suspendedBlocks')}` : ''}
          </p>
        </Alert>
      ) : null}

      <section aria-labelledby="actions-heading">
        <h2 id="actions-heading" className="sr-only">
          {t('actionsHeading')}
        </h2>
        <ProjectActionsPanel project={project} />
      </section>

      <Overview project={project} locale={locale} />

      <section aria-labelledby="members-heading">
        <h2
          id="members-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('membersHeading')}
        </h2>
        {/*
          Deliberately not a member list. `addMember` requires the caller to already be a
          member and `create` never enrols one, so no project can have members yet (B1).
          Rendering an empty roster would imply the team is unassigned rather than that
          the capability is missing.
        */}
        <div className="mt-3 rounded-lg border border-dashed border-border bg-surface px-6 py-8 text-center">
          <p className="text-sm text-foreground">{t('membersUnavailable')}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t('membersUnavailableHint')}</p>
        </div>
      </section>
    </div>
  );
}

function Overview({
  project,
  locale,
}: {
  project: ProjectDetailModel;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.projects.detail');

  const rows: Array<{ label: string; value: string | null }> = [
    { label: t('client'), value: project.clientName },
    { label: t('contractValue'), value: formatMoney(project.contractValue, project.currency, locale) },
    { label: t('startDate'), value: formatDate(project.startDate, locale) },
    { label: t('expectedEnd'), value: formatDate(project.expectedEndDate, locale) },
    { label: t('created'), value: formatDate(project.createdAt, locale) },
  ];

  return (
    <section aria-labelledby="overview-heading">
      <h2
        id="overview-heading"
        className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {t('overview')}
      </h2>

      <dl className="mt-3 grid gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-2">
        {rows.map((row) => (
          <div key={row.label} className="bg-surface px-4 py-3">
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-foreground">
              {row.value ?? <span className="font-normal text-muted-foreground">{t('notSet')}</span>}
            </dd>
          </div>
        ))}

        {project.description ? (
          <div className="bg-surface px-4 py-3 sm:col-span-2">
            <dt className="text-xs text-muted-foreground">{t('description')}</dt>
            <dd className="mt-0.5 whitespace-pre-line text-sm text-foreground">
              {project.description}
            </dd>
          </div>
        ) : null}

        {/*
          The hairlines are the container's background showing through a 1px grid gap. With
          an odd number of cells the trailing empty track shows that colour as a solid grey
          block, so a filler cell is rendered to complete the row. Decorative only.
        */}
        {rows.length % 2 === 1 && !project.description ? (
          <div className="hidden bg-surface sm:block" aria-hidden="true" />
        ) : null}
      </dl>
    </section>
  );
}
