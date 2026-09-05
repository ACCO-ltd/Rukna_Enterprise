'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button, DefinitionList, DefinitionRow, RecordPanel } from '@erp/ui';
import { ArrowRight, Building2, CircleCheck, FileText, History, PencilLine } from 'lucide-react';

import { ApiError } from '@/lib/api-client';
import { formatDate, formatMoney } from '@/lib/format';

import { usePermissions } from '@/features/auth/permissions/can';

import { useProject, useProjectWorkspaceSummary } from '../hooks/use-project';
import { ProjectCommitmentsCard } from '@/features/procurement/components/commitments';
import { ProjectProgressCard } from '@/features/progress/components/project-progress-card';
import { CommercialSummaryStrip } from '@/features/commercial/components/commercial-summary-strip';
import { useCommercialSummary } from '@/features/commercial/hooks/use-commercial';

import { PROJECT_PERMISSIONS } from '../permissions';
import type { ProjectDetail as ProjectDetailModel, ProjectWorkspaceSummary } from '../types';
import { ProjectLifecycleRail } from './project-lifecycle-rail';
import { ProjectReadiness } from './project-readiness';

export function ProjectDetail({ id }: { id: string }) {
  const t = useTranslations('platform.projects.detail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const searchParams = useSearchParams();
  const [showCreated, setShowCreated] = useState(searchParams?.get('created') === '1');
  const { data: project, isPending, isError, error } = useProject(id);
  const summary = useProjectWorkspaceSummary(id);

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

      <Overview
        project={project}
        locale={locale}
        summary={summary.data}
        summaryPending={summary.isPending}
        summaryError={summary.isError}
      />
    </div>
  );
}

// ─── Overview ─────────────────────────────────────────────────────────────────

/**
 * The project's own tab, and the only one carrying project-level context.
 *
 * It is lifecycle-aware rather than a fixed set of panels. In preparation the page answers one
 * question — *what is stopping this project from starting?* — so readiness leads and the
 * money, which is all zero, follows. Once the project is running that question is settled and
 * the readiness checklist disappears rather than standing as a permanent "4 of 4 complete";
 * physical progress and the revenue chain take the lead instead.
 *
 * Six regions, each a bounded `RecordPanel`. The first build made them open hairline sections,
 * which is the doctrine's default (§2.1) and the right call in one column — but this page is two
 * columns, and there a rule under every heading produces rules at six different heights across
 * the page with nothing bounding any of them. Rendered, it read as one undifferentiated field of
 * text. A panel per *region* is not the anti-pattern the doctrine blacklists; a panel per *fact*
 * is, and that is what the original Overview did with three identity cards.
 */
function Overview({
  project,
  locale,
  summary,
  summaryPending,
  summaryError,
}: {
  project: ProjectDetailModel;
  locale: 'en' | 'ar';
  summary: ProjectWorkspaceSummary | undefined;
  summaryPending: boolean;
  summaryError: boolean;
}) {
  const t = useTranslations('platform.projects.detail');
  const isDraft = project.status === 'DRAFT';
  // The Commercial tab's own summary, so the Overview band and that tab can never
  // disagree about the same five figures.
  const commercial = useCommercialSummary(project.id);

  return (
    // `gap-5` throughout, matching `RecordLayout`: the panel edges are what separate one region
    // from the next now, so the gutter only has to keep them from touching.
    <div className="space-y-5">
      <ProjectLifecycleRail status={project.status} />

      {summaryError ? <Alert variant="warning" messages={[t('summaryUnavailable')]} /> : null}

      {/* The revenue chain — value → certified → invoiced → received → outstanding. Nothing to
          say about a project that has not started, so it waits until there is. */}
      {!isDraft && commercial.data ? <CommercialSummaryStrip summary={commercial.data} /> : null}

      {/* Left column: what the project is doing. Right column: what it is.

          1.4fr/1fr — 58/42 — rather than `RecordLayout`'s 1.7/1. That ratio is tuned for a
          narrow summary rail beside a wide table; here the right column carries three full
          sections of label/value pairs while the left carries a checklist and three figures.
          At 1366 the old split left the right column wrapping values the left column had room
          to spare for. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {isDraft ? (
            summaryPending ? (
              <div
                className="h-56 animate-pulse rounded-panel border border-border bg-muted"
                aria-hidden="true"
              />
            ) : summary ? (
              <ProjectReadiness project={project} setup={summary.setup} />
            ) : null
          ) : (
            <ProjectProgressCard projectId={project.id} />
          )}

          <ProjectCommitmentsCard
            projectId={project.id}
            currencyCode={summary?.mainContract?.currency ?? project.currency ?? null}
            presentation="overview"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-5">
          <ProjectInformation project={project} locale={locale} />
          <CommercialFoundation project={project} summary={summary} locale={locale} />
          <RecentActivity summary={summary} locale={locale} />
        </div>
      </div>
    </div>
  );
}

// ─── Project information ──────────────────────────────────────────────────────

/**
 * What the project *is*: classification, delivery shape, where it is, when it runs.
 *
 * Project code and client are deliberately absent — both are two lines up in the workspace
 * header, and a fact restated one screen from itself is a fact the reader has to reconcile.
 * Empty optional fields are dropped rather than rendered as a dash: a column of `—` is a
 * picture of the database schema, not of the project.
 */
function ProjectInformation({
  project,
  locale,
}: {
  project: ProjectDetailModel;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.projects.detail');
  const tProjects = useTranslations('platform.projects');
  const tTypes = useTranslations('projectTypes');
  const { can } = usePermissions();

  const startDate = formatDate(project.startDate, locale);
  const endDate = formatDate(project.expectedEndDate, locale);

  const rows: Array<{ label: string; value: string | null }> = [
    {
      label: tTypes('display.categoryLabel'),
      // Legacy projects created before the field existed read as "Untyped" rather than
      // being given a category they were never classified with.
      value: project.category
        ? tTypes(`categories.${project.category}`)
        : tTypes('display.untyped'),
    },
    ...(project.subtype
      ? [{ label: tTypes('display.subtypeLabel'), value: project.subtype.name }]
      : []),
    {
      label: tProjects('create.participationModelLabel'),
      value: project.participationModel
        ? tProjects(
            `create.participationModel.${project.participationModel === 'JOINT_VENTURE' ? 'jointVenture' : 'sole'}`,
          )
        : null,
    },
    ...(project.location ? [{ label: t('location'), value: project.location }] : []),
    ...(startDate ? [{ label: t('startDate'), value: startDate }] : []),
    ...(endDate ? [{ label: t('expectedEnd'), value: endDate }] : []),
    ...(project.description ? [{ label: t('description'), value: project.description }] : []),
  ];

  return (
    <RecordPanel
      title={t('projectInformation')}
      icon={<FileText size={17} strokeWidth={1.9} />}
      action={
        /* Contextual, so it says what it edits. Two conditions, and they are different kinds
           of thing: only a draft accepts edits at all (a lifecycle rule), and
           `PATCH /projects/:id` requires `manage:project` (an authorization rule). */
        project.status === 'DRAFT' && can(PROJECT_PERMISSIONS.manage) ? (
          <Link
            href={`/projects/${project.id}/edit`}
            className="inline-flex items-center gap-1.5 text-caption font-medium text-brand-primary hover:underline"
          >
            <PencilLine size={14} aria-hidden="true" />
            {t('edit')}
          </Link>
        ) : null
      }
    >
      {/* Hairline rows are right again now that a panel bounds them — that is the composition
          `DefinitionRow` was drawn for, and inside an edge they read as one table rather than
          as loose rules on an open page. */}
      <DefinitionList>
        {rows.map((row) => (
          <DefinitionRow key={row.label} label={row.label}>
            {row.value}
          </DefinitionRow>
        ))}
      </DefinitionList>
    </RecordPanel>
  );
}

// ─── Commercial foundation ────────────────────────────────────────────────────

/**
 * The commercial facts a project stands on, separated from its identity because they are
 * configuration and state rather than what the project is.
 *
 * Absence is stated in business terms. "Main contract — " tells a reader a value is missing;
 * "Main contract  Not created" tells them what has not happened yet, which is the thing they
 * can act on. Billing model and contract value are hidden entirely until a contract exists to
 * give them meaning — an empty row for a figure that cannot exist yet is noise.
 */
function CommercialFoundation({
  project,
  summary,
  locale,
}: {
  project: ProjectDetailModel;
  summary: ProjectWorkspaceSummary | undefined;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.projects.detail');
  const tProjects = useTranslations('platform.projects');

  const setup = summary?.setup;
  const mainContract = summary?.mainContract ?? null;
  const contractApplicable = project.commercialModel !== 'INTERNAL_CAPITAL';

  const boqStatus = !setup
    ? null
    : setup.boqBaselined
      ? t('boqBaselined')
      : setup.boqExists
        ? t('boqWorking')
        : t('boqNotStarted');

  const contractValue = mainContract?.contractValue
    ? formatMoney(mainContract.contractValue, mainContract.currency, locale)
    : null;

  // The contract owns the currency. `toCreateProjectPayload` deliberately never sends one —
  // "Commercial value and currency intentionally do not travel through this workflow" — so
  // `Project.currency` is a legacy read-compatible column that is NULL on everything the app
  // creates. Before a contract exists there is genuinely no answer, and the row is dropped
  // rather than showing a dash for a fact that cannot exist yet, on the same rule as contract
  // value below it. It is emphatically NOT defaulted to USD: ACCO being USD-only today
  // (ADR-024) is a tenant fact, not a reason for the UI to state a currency nobody chose.
  const currency = mainContract?.currency ?? project.currency ?? null;

  return (
    <RecordPanel
      title={t('commercialFoundation')}
      icon={<Building2 size={17} strokeWidth={1.9} />}
      action={
        <Link
          href={`/projects/${project.id}/commercial`}
          className="inline-flex items-center gap-1.5 text-caption font-medium text-brand-primary hover:underline"
        >
          {t('openCommercial')}
          <ArrowRight size={14} className="rtl:rotate-180" aria-hidden="true" />
        </Link>
      }
    >
      <DefinitionList>
        <DefinitionRow label={t('commercialModel')}>
          {tProjects(
            `create.commercialModel.${project.commercialModel === 'INTERNAL_CAPITAL' ? 'internalCapital' : 'clientContract'}`,
          )}
        </DefinitionRow>
        <DefinitionRow label={t('boqStatus')}>{boqStatus}</DefinitionRow>
        <DefinitionRow label={t('mainContract')}>
          {!contractApplicable ? (
            t('notApplicable')
          ) : mainContract ? (
            <Link
              href={`/contracts/${mainContract.id}`}
              className="font-medium text-brand-primary hover:underline"
            >
              {mainContract.contractNumber}
            </Link>
          ) : (
            t('notCreated')
          )}
        </DefinitionRow>
        {contractValue ? (
          <DefinitionRow label={t('contractValue')} numeric>
            {contractValue}
          </DefinitionRow>
        ) : null}
        {currency ? (
          <DefinitionRow label={t('currency')}>{currency}</DefinitionRow>
        ) : null}
      </DefinitionList>
    </RecordPanel>
  );
}

// ─── Recent activity ──────────────────────────────────────────────────────────

/**
 * The last five things that happened to this project, as a feed rather than a table.
 *
 * There is no "View all" link: the API returns five events and has no project-scoped history
 * endpoint behind them, and `/admin/audit-logs` is org-wide and permission-gated, so pointing
 * at it would send most readers to a 403 for someone else's records.
 */
function RecentActivity({
  summary,
  locale,
}: {
  summary: ProjectWorkspaceSummary | undefined;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('platform.projects.detail');

  if (!summary) return null;

  return (
    <RecordPanel title={t('recentActivity')} icon={<History size={17} strokeWidth={1.9} />}>
      {summary.recentActivity.length > 0 ? (
        <ol className="flex flex-col gap-3">
          {summary.recentActivity.map((event) => (
            <li key={event.id}>
              <p className="text-body-sm font-medium text-foreground">
                {activityLabel(event.sourceCommand ?? event.action, t)}
              </p>
              <p className="mt-0.5 text-caption text-muted-foreground">
                {event.actor.name}
                <span aria-hidden="true"> · </span>
                <time dateTime={event.occurredAt}>
                  {formatActivityTime(event.occurredAt, locale)}
                </time>
              </p>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-caption text-muted-foreground">{t('noRecentActivity')}</p>
      )}
    </RecordPanel>
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
    // Retired commands (the approve → mobilize → activate chain, ADR-019) still have audit
    // rows behind them, so they keep their labels even though nothing writes them now.
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
