'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { useProject } from '../hooks/use-project';
import { ProjectCommitmentsCard } from '@/features/procurement/components/commitments';

import { getAvailableActions } from '../project-actions';
import type { ProjectDetail as ProjectDetailModel } from '../types';
import { ProjectActionsPanel } from './project-actions-panel';

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

  const suspension = project.suspensions.find((s) => s.resumedAt === null);
  const actions = getAvailableActions(project);

  return (
    <div className="space-y-6">
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

      {/* Sprint 5 (§12.9). Hidden entirely without `view:commitment-ledger` rather than
          rendered empty — an empty commitments card reads as "this project has committed
          nothing", which is a different and more dangerous claim. */}
      <ProjectCommitmentsCard projectId={project.id} currencyCode={project.currency} />
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
