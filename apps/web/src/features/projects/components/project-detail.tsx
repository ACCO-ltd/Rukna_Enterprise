'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DefinitionList, DefinitionRow, SectionHeader } from '@erp/ui';
import {
  ArrowRight,
  AlertTriangle,
  Check,
  CircleCheck,
  History,
  Lock,
  LockKeyhole,
} from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import {
  useProject,
  useProjectWorkspaceGuidance,
  useProjectWorkspaceSummary,
} from '../hooks/use-project';
import { ProjectCommitmentsCard } from '@/features/procurement/components/commitments';
import { ProjectProgressCard } from '@/features/progress/components/project-progress-card';

import { getAvailableActions } from '../project-actions';
import type { ProjectDetail as ProjectDetailModel } from '../types';
import type { ProjectWorkspaceSummary } from '../types';
import { ProjectActionsPanel } from './project-actions-panel';

export function ProjectDetail({ id }: { id: string }) {
  const t = useTranslations('platform.projects.detail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const searchParams = useSearchParams();
  const [showCreated, setShowCreated] = useState(searchParams?.get('created') === '1');
  const { data: project, isPending, isError, error } = useProject(id);
  const summary = useProjectWorkspaceSummary(id);
  const guidance = useProjectWorkspaceGuidance(id);

  useEffect(() => {
    if (!showCreated) return;
    const timer = window.setTimeout(() => setShowCreated(false), 6000);
    window.history.replaceState(null, '', window.location.pathname);
    return () => window.clearTimeout(timer);
  }, [showCreated]);

  if (isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div
          className="h-64 animate-pulse rounded-panel border border-border bg-muted"
          aria-hidden="true"
        />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && (error.status === 404 || error.status === 403);
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
      {showCreated ? (
        <div
          className="fixed end-5 top-5 z-50 flex max-w-sm items-start gap-3 rounded-control border border-success/30 bg-surface px-4 py-3 shadow-e3"
          role="status"
          aria-live="polite"
        >
          <CircleCheck className="mt-0.5 h-5 w-5 shrink-0 text-success" aria-hidden="true" />
          <div>
            <p className="text-sm font-semibold text-foreground">{t('createdTitle')}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{project.name}</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{project.code}</p>
          </div>
        </div>
      ) : null}
      {suspension ? (
        <Alert variant="warning" title={t('suspendedTitle')}>
          <p className="mt-1">{suspension.reason}</p>
          <p className="mt-2 text-xs">
            {t('suspendedSince', { date: formatDate(suspension.suspendedAt, locale) ?? '—' })}
            {actions.advanceBlockedBySuspension ? ` ${t('suspendedBlocks')}` : ''}
          </p>
        </Alert>
      ) : null}

      <ProjectHeaderActions project={project} label={t('actionsHeading')} />

      <Overview
        project={project}
        locale={locale}
        summary={summary.data}
        summaryPending={summary.isPending}
        summaryError={summary.isError}
        guidance={guidance.data}
        guidancePending={guidance.isPending}
        guidanceError={guidance.isError}
      />
    </div>
  );
}

function ProjectHeaderActions({ project, label }: { project: ProjectDetailModel; label: string }) {
  const target = useSyncExternalStore(
    (onStoreChange) => {
      const observer = new MutationObserver(onStoreChange);
      observer.observe(document.body, { childList: true, subtree: true });
      return () => observer.disconnect();
    },
    () => document.getElementById('project-header-actions'),
    () => null,
  );

  const actions = (
    <section aria-label={label} className="flex flex-wrap items-center justify-end gap-2">
      <ProjectActionsPanel project={project} />
    </section>
  );

  return target ? createPortal(actions, target) : actions;
}

// ─── Overview ─────────────────────────────────────────────────────────────────

function Overview({
  project,
  locale,
  summary,
  summaryPending,
  summaryError,
  guidance,
  guidancePending,
  guidanceError,
}: {
  project: ProjectDetailModel;
  locale: 'en' | 'ar';
  summary: ProjectWorkspaceSummary | undefined;
  summaryPending: boolean;
  summaryError: boolean;
  guidance: import('../types').ProjectWorkspaceGuidanceItem[] | undefined;
  guidancePending: boolean;
  guidanceError: boolean;
}) {
  const t = useTranslations('platform.projects.detail');
  const tProjects = useTranslations('platform.projects');
  const contractValueDisplay = formatMoney(
    summary?.mainContract?.contractValue ?? null,
    summary?.mainContract?.currency ?? null,
    locale,
  );

  // Identity facts the shell metric strip does NOT already carry. Programme, current stage,
  // contract value and project manager live in the strip and lifecycle above (P2), so they are
  // deliberately absent here — one summary, not two competing ones. A single hairline section,
  // no per-fact cards (P1).
  const mainContractRef =
    summary?.mainContract?.contractNumber ??
    (project.commercialModel === 'INTERNAL_CAPITAL' ? t('notApplicable') : null);

  const details: Array<{ label: string; value: string | null }> = [
    { label: t('client'), value: project.clientName },
    { label: t('mainContract'), value: mainContractRef },
    {
      label: t('commercialModel'),
      value: tProjects(
        `create.commercialModel.${project.commercialModel === 'INTERNAL_CAPITAL' ? 'internalCapital' : 'clientContract'}`,
      ),
    },
    {
      label: tProjects('create.participationModelLabel'),
      value: project.participationModel
        ? tProjects(
            `create.participationModel.${project.participationModel === 'JOINT_VENTURE' ? 'jointVenture' : 'sole'}`,
          )
        : null,
    },
    { label: t('location'), value: project.location ?? null },
    { label: t('projectCode'), value: project.code },
    { label: t('description'), value: project.description },
  ];

  return (
    <div className="space-y-5">
      <WorkspaceGuidancePanel
        items={guidance}
        isPending={guidancePending}
        isError={guidanceError}
      />

      {project.status === 'DRAFT' ? (
        summaryPending ? (
          <div className="h-40 animate-pulse rounded-panel border border-border bg-muted" />
        ) : summary ? (
          <SetupStepper project={project} summary={summary} />
        ) : null
      ) : null}

      {summaryError ? <Alert variant="warning" messages={[t('summaryUnavailable')]} /> : null}

      <section aria-labelledby="overview-heading">
        <SectionHeader id="overview-heading" title={t('projectDetails')}>
          {project.status === 'DRAFT' ? (
            <Link
              href={`/projects/${project.id}/edit`}
              className="text-caption font-medium text-brand-primary hover:underline"
            >
              {t('editInformation')}
            </Link>
          ) : null}
        </SectionHeader>
        {/* One hairline definition list, two columns on desktop, single-column at 375px — not a
            card per fact (P1/P2). DefinitionRow renders `—` for a missing value on its own. */}
        <DefinitionList className="mt-3 grid gap-x-8 sm:grid-cols-2">
          {details.map((row) => (
            <DefinitionRow key={row.label} label={row.label}>
              {row.value}
            </DefinitionRow>
          ))}
        </DefinitionList>
      </section>

      <section
        className={cn('grid gap-4', project.status === 'DRAFT' ? 'lg:grid-cols-2' : 'lg:grid-cols-3')}
        aria-label={t('commercialCostPosition')}
      >
        {project.status === 'DRAFT' ? null : <ProjectProgressCard projectId={project.id} />}
        {/* Commercial snapshot keeps its card: it owns a link and a figure the strip does not
            carry (contract value). Main contract is dropped here — the shell strip and the
            Project details list already show it, this must not be a third copy (P2). */}
        <div className="overflow-hidden rounded-panel border border-border bg-surface">
          <div className="flex min-h-12 items-center justify-between border-b border-border px-5">
            <h2 className="text-body-sm font-semibold text-foreground">
              {t('commercialSnapshot')}
            </h2>
            {summary?.mainContract ? (
              <Link
                href={`/projects/${project.id}/commercial`}
                className="text-caption font-medium text-brand-primary hover:underline"
              >
                {t('openCommercial')}
              </Link>
            ) : null}
          </div>
          <div className="px-5 py-3">
            <dl>
              <div className="flex items-center justify-between gap-4 py-2.5">
                <dt className="text-caption text-muted-foreground">{t('contractValue')}</dt>
                <dd className="text-body-sm font-semibold tabular-nums text-foreground">
                  {summary?.financialsVisible ? (
                    (contractValueDisplay ?? t('notSet'))
                  ) : (
                    <span className="inline-flex items-center gap-1.5 font-medium text-muted-foreground">
                      <LockKeyhole size={14} aria-hidden="true" />
                      {t('valueRestricted')}
                    </span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>
        <ProjectCommitmentsCard
          projectId={project.id}
          currencyCode={summary?.mainContract?.currency ?? null}
        />
      </section>

      {summary ? (
        <section aria-labelledby="recent-activity-heading">
          <div className="overflow-hidden rounded-panel border border-border bg-surface">
            <div className="flex min-h-12 items-center gap-2 border-b border-border px-5">
              <History size={16} className="text-muted-foreground" aria-hidden="true" />
              <h2
                id="recent-activity-heading"
                className="text-body-sm font-semibold text-foreground"
              >
                {t('recentActivity')}
              </h2>
            </div>
            {summary.recentActivity.length > 0 ? (
              <ol className="divide-y divide-border">
                {summary.recentActivity.map((event) => (
                  <li
                    key={event.id}
                    className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">
                        {t('activityEvent', {
                          actor: event.actor.name,
                          action: activityLabel(event.sourceCommand ?? event.action, t),
                        })}
                      </p>
                    </div>
                    <time
                      className="shrink-0 text-xs text-muted-foreground"
                      dateTime={event.occurredAt}
                    >
                      {formatActivityTime(event.occurredAt, locale)}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                {t('noRecentActivity')}
              </p>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function WorkspaceGuidancePanel({
  items,
  isPending,
  isError,
}: {
  items: import('../types').ProjectWorkspaceGuidanceItem[] | undefined;
  isPending: boolean;
  isError: boolean;
}) {
  const t = useTranslations('platform.projects.detail');
  if (isPending)
    return <div className="h-24 animate-pulse rounded-panel border border-border bg-muted" />;
  if (isError) return <Alert variant="warning" messages={[t('attentionUnavailable')]} />;
  const visible = items ?? [];
  return (
    <section aria-labelledby="workspace-guidance-heading">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={17}
            className={visible.length ? 'text-warning' : 'text-success'}
            aria-hidden="true"
          />
          <h2
            id="workspace-guidance-heading"
            className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground"
          >
            {t('workspaceGuidance')}
          </h2>
        </div>
        {visible.length ? (
          <span className="text-caption text-muted-foreground">
            {t('attentionCount', { count: items?.length ?? 0 })}
          </span>
        ) : null}
      </div>
      {visible.length ? (
        <div className="divide-y divide-border rounded-panel border border-border bg-surface shadow-e1">
          {visible.map((item) => (
            <div
              key={item.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5"
            >
              <div>
                <p className="text-body-sm font-semibold text-foreground">
                  {t(`attention.${item.kind}.title`)}
                </p>
                <p className="mt-1 text-caption text-muted-foreground">
                  {t(`attention.${item.kind}.description`)}
                </p>
                {item.responsibleRole ? (
                  <p className="mt-1 text-micro font-medium text-muted-foreground">
                    {t('responsibleRole', { role: t(`roles.${item.responsibleRole}`) })}
                  </p>
                ) : null}
              </div>
              {item.actionUrl ? (
                <Button variant="outline" size="sm" asChild>
                  <Link href={item.actionUrl}>{t(`attention.${item.kind}.action`)}</Link>
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-panel border border-success/20 bg-success/5 px-5 py-4">
          <p className="text-body-sm font-semibold text-foreground">{t('attentionClear')}</p>
          <p className="mt-1 text-caption text-muted-foreground">{t('attentionClearHint')}</p>
        </div>
      )}
    </section>
  );
}

function formatActivityTime(value: string, locale: 'en' | 'ar'): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function activityLabel(
  command: string,
  t: (
    key:
      | 'activityProjectCreated'
      | 'activityProjectUpdated'
      | 'activityProjectSuspended'
      | 'activityProjectResumed'
      | 'activityProjectApproved'
      | 'activityProjectMobilized'
      | 'activityProjectActivated'
      | 'activityPracticalCompletion'
      | 'activityProjectCloseout'
      | 'activityProjectClosed'
      | 'activityProjectCancelled'
      | 'activityProjectChanged',
  ) => string,
): string {
  const labels: Record<string, string> = {
    'project.create': t('activityProjectCreated'),
    'project.update': t('activityProjectUpdated'),
    'project.suspend': t('activityProjectSuspended'),
    'project.resume': t('activityProjectResumed'),
    'project.approve': t('activityProjectApproved'),
    'project.mobilize': t('activityProjectMobilized'),
    'project.activate': t('activityProjectActivated'),
    'project.practical-completion': t('activityPracticalCompletion'),
    'project.closeout': t('activityProjectCloseout'),
    'project.close': t('activityProjectClosed'),
    'project.cancel': t('activityProjectCancelled'),
  };
  return labels[command] ?? t('activityProjectChanged');
}

// ─── Setup stepper ────────────────────────────────────────────────────────────

interface StepDef {
  labelKey: 'setupProject' | 'setupBoq' | 'setupContract' | 'setupTeam';
  descKey: 'setupProjectDesc' | 'setupBoqDesc' | 'setupContractDesc' | 'setupTeamDesc';
  complete: boolean;
  /** Cannot act yet — a prior step must be done first. */
  locked: boolean;
  /** Where the action button navigates. Omitted if complete or locked. */
  href?: string;
  actionKey?: 'continueSetup' | 'createContract' | 'addTeam';
  /** Short reason shown when locked. */
  blockedKey?: 'setupContractBlocked';
}

function SetupStepper({
  project,
  summary,
}: {
  project: ProjectDetailModel;
  summary: ProjectWorkspaceSummary;
}) {
  const t = useTranslations('platform.projects.detail');
  const steps: StepDef[] = [
    {
      labelKey: 'setupProject',
      descKey: 'setupProjectDesc',
      complete: true,
      locked: false,
    },
    {
      labelKey: 'setupBoq',
      descKey: 'setupBoqDesc',
      complete: summary.setup.boqBaselined,
      locked: false,
      href: `/projects/${project.id}/boq`,
      actionKey: 'continueSetup',
    },
    ...(project.commercialModel === 'INTERNAL_CAPITAL'
      ? []
      : [
          {
            labelKey: 'setupContract' as const,
            descKey: 'setupContractDesc' as const,
            complete: summary.setup.mainContractExists,
            locked: !summary.setup.boqBaselined,
            href: summary.setup.boqBaselined ? `/contracts/new?projectId=${project.id}` : undefined,
            actionKey: 'createContract' as const,
            blockedKey: 'setupContractBlocked' as const,
          },
        ]),
    {
      labelKey: 'setupTeam',
      descKey: 'setupTeamDesc',
      complete: summary.setup.teamReady,
      locked: false,
      href: `/projects/${project.id}/members`,
      actionKey: 'addTeam',
    },
  ];

  const doneCount = summary.setup.completedSteps;
  const total = summary.setup.totalSteps;
  const progressPct = Math.round((doneCount / total) * 100);

  return (
    <section
      aria-labelledby="setup-heading"
      className="overflow-hidden rounded-container border border-border bg-surface shadow-e1"
    >
      <div className="border-b border-border px-4 py-3 sm:px-5">
        <div className="flex items-center justify-between gap-4">
          <h2 id="setup-heading" className="text-body-sm font-semibold text-foreground">
            {t('setup')}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full bg-brand-primary/10 px-2 py-0.5 text-micro font-bold tabular-nums text-brand-primary">
              {progressPct}%
            </span>
            <span className="text-caption font-medium text-muted-foreground">
              {t('setupProgress', { done: doneCount, total })}
            </span>
          </div>
        </div>
        <span
          className="sr-only"
          role="progressbar"
          aria-valuenow={doneCount}
          aria-valuemin={0}
          aria-valuemax={total}
        />
      </div>

      {/* Steps */}
      <ol className="flex min-w-max overflow-x-auto px-4 py-4 [-webkit-overflow-scrolling:touch] lg:min-w-0 lg:overflow-visible lg:px-5">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isNextAction =
            !step.complete &&
            !step.locked &&
            steps.slice(0, index).every((s) => s.complete || s.locked);

          return (
            <li
              key={step.labelKey}
              className="relative flex w-56 shrink-0 gap-3 pe-5 last:pe-0 lg:w-auto lg:min-w-0 lg:flex-1"
            >
              {/* Left column: indicator + connecting line */}
              <div className="flex flex-col items-center">
                <StepIndicator
                  index={index}
                  complete={step.complete}
                  isNextAction={isNextAction}
                  locked={step.locked}
                />
                {!isLast ? (
                  <div
                    className={cn(
                      'absolute start-6 top-3 h-px w-[calc(100%-1.5rem)]',
                      step.complete ? 'bg-success/40' : 'bg-border',
                    )}
                    aria-hidden="true"
                  />
                ) : null}
              </div>

              {/* Right column: content */}
              <div className="relative z-10 min-w-0 flex-1 bg-surface pe-2">
                <p
                  className={cn(
                    'truncate text-caption font-semibold leading-5',
                    step.complete
                      ? 'text-foreground'
                      : step.locked
                        ? 'text-muted-foreground/60'
                        : 'text-foreground',
                  )}
                >
                  {t(step.labelKey)}
                </p>

                <p
                  className={cn(
                    'mt-0.5 text-micro font-semibold uppercase tracking-[0.06em]',
                    step.complete
                      ? 'text-success'
                      : step.locked
                        ? 'text-warning'
                        : isNextAction
                          ? 'text-brand-primary'
                          : 'text-muted-foreground',
                  )}
                >
                  {step.complete
                    ? t('setupComplete')
                    : step.locked
                      ? t('setupBlocked')
                      : t('setupPending')}
                </p>

                {!step.complete ? (
                  <p
                    className={cn(
                      'mt-0.5 line-clamp-1 text-caption leading-4',
                      step.complete || step.locked
                        ? 'text-muted-foreground/70'
                        : 'text-muted-foreground',
                    )}
                  >
                    {t(step.descKey)}
                  </p>
                ) : null}

                {/* Locked reason */}
                {step.locked && step.blockedKey ? (
                  <p
                    className="mt-1 line-clamp-1 text-micro font-medium text-warning"
                    title={t(step.blockedKey)}
                  >
                    {t(step.blockedKey)}
                  </p>
                ) : null}

                {/* Action button — only on incomplete, unlocked steps */}
                {!step.complete && !step.locked && step.href && step.actionKey ? (
                  <div className="mt-1.5">
                    <Button variant="outline" size="sm" asChild>
                      <Link href={step.href} className="gap-2">
                        {t(step.actionKey)}
                        <ArrowRight size={14} className="rtl:rotate-180" aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

// ─── Step indicator (circle with number or check) ─────────────────────────────

function StepIndicator({
  index,
  complete,
  isNextAction,
  locked,
}: {
  index: number;
  complete: boolean;
  isNextAction: boolean;
  locked: boolean;
}) {
  if (complete) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-white">
        <Check size={12} strokeWidth={3} aria-hidden="true" />
      </span>
    );
  }

  if (isNextAction) {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-primary text-micro font-bold text-white ring-4 ring-brand-primary/15">
        {index + 1}
      </span>
    );
  }

  if (locked) {
    return (
      <span className="relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-warning/30 bg-surface text-warning">
        <Lock size={12} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-border bg-surface text-micro font-semibold text-muted-foreground">
      {index + 1}
    </span>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

// ─── Utility ──────────────────────────────────────────────────────────────────

function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ');
}
