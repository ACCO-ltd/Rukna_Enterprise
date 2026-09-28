'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  DefinitionList,
  DefinitionRow,
  MoneyDisplay,
  StatusPill,
  useToast,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { statusTone } from '@/lib/status-registry';

import { usePermissions } from '@/features/auth/permissions/can';

import { useProject, useProjectWorkspaceSummary } from '../hooks/use-project';
import { ProjectCommitmentsCard } from '@/features/procurement/components/commitments';
import { ProjectProgressCard } from '@/features/progress/components/project-progress-card';
import { CommercialSummaryStrip } from '@/features/commercial/components/commercial-summary-strip';
import { useCommercialSummary } from '@/features/commercial/hooks/use-commercial';

import { PROJECT_PERMISSIONS } from '../permissions';
import type { ProjectDetail as ProjectDetailModel, ProjectWorkspaceSummary } from '../types';
import { ActivityList, ProjectActivitySheet } from './project-activity-sheet';
import { ProjectReadiness } from './project-readiness';

export function ProjectDetail({ id }: { id: string }) {
  const t = useTranslations('platform.projects.detail');
  const tCommon = useTranslations('common');
  const locale = useLocale() as 'en' | 'ar';
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { data: project, isPending, isError, error } = useProject(id);
  const summary = useProjectWorkspaceSummary(id);

  // Arriving from "Save project" (`?created=1`): confirm with the app's toast — the same one the
  // client form uses — rather than a hand-rolled fixed card (flow plan B8). Once, then drop the
  // flag so a reload does not repeat it.
  const announced = useRef(false);
  const justCreated = searchParams?.get('created') === '1';
  useEffect(() => {
    if (!justCreated || !project || announced.current) return;
    announced.current = true;
    toast({
      tone: 'success',
      title: t('createdTitle'),
      description: `${project.name} · ${project.code}`,
    });
    window.history.replaceState(null, '', window.location.pathname);
  }, [justCreated, project, t, toast]);

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
      <Overview
        project={project}
        locale={locale}
        summary={summary.data}
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
 * question — *what is left before this project can start?* — so the readiness checklist leads.
 * Once the project is running that question is settled and the checklist disappears rather than
 * standing as a permanent "6 of 6"; physical progress and the revenue chain take the lead.
 *
 * There is no lifecycle stepper here. The status pill in the header is the one lifecycle
 * indicator; a second one on this tab could only repeat it, or disagree with it.
 *
 * The right rail is plain sections — a hairline header and label/value rows — not boxed cards:
 * it is reference material beside the work, and a card per section made three competing boxes.
 */
function Overview({
  project,
  locale,
  summary,
  summaryError,
}: {
  project: ProjectDetailModel;
  locale: 'en' | 'ar';
  summary: ProjectWorkspaceSummary | undefined;
  summaryError: boolean;
}) {
  const t = useTranslations('platform.projects.detail');
  const isDraft = project.status === 'DRAFT';
  // The Commercial tab's own summary, so the Overview band and that tab can never
  // disagree about the same five figures.
  const commercial = useCommercialSummary(project.id);

  return (
    <div className="space-y-5">
      {summaryError ? <Alert variant="warning" messages={[t('summaryUnavailable')]} /> : null}

      {/* The revenue chain — value → certified → invoiced → received → outstanding. Nothing to
          say about a project that has not started, so it waits until there is. */}
      {!isDraft && commercial.data ? <CommercialSummaryStrip summary={commercial.data} /> : null}

      {/* Main column: what the project is doing. Rail (320px): what it is. Below 900px the rail
          drops under the main column in source order. */}
      <div className="grid gap-6 min-[900px]:grid-cols-[minmax(0,1fr)_20rem] min-[900px]:gap-8">
        <div className="flex min-w-0 flex-col gap-5">
          {isDraft ? (
            <ProjectReadiness project={project} />
          ) : (
            <ProjectProgressCard projectId={project.id} />
          )}

          {!isDraft ? (
            <ProjectCommitmentsCard
              projectId={project.id}
              currencyCode={summary?.mainContract?.currency ?? project.currency ?? null}
              presentation="overview"
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-7">
          <ProjectInformation project={project} locale={locale} />
          <CommercialFoundation project={project} summary={summary} />
          <RecentActivity projectId={project.id} summary={summary} />
        </div>
      </div>
    </div>
  );
}

// ─── Rail section ─────────────────────────────────────────────────────────────

/** A hairline header — a title and at most one text link — over label/value rows. */
function RailSection({
  id,
  title,
  action,
  children,
}: {
  id: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="min-w-0">
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-border pb-1.5">
        <h2 id={id} className="text-h3 font-semibold text-foreground">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const railLinkClass =
  'inline-flex min-h-8 items-center rounded-control px-1 text-caption font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:shadow-ring';

// ─── Project information ──────────────────────────────────────────────────────

/**
 * What the project *is*: classification, delivery shape, when it runs.
 *
 * Project code, client and site are deliberately absent — all three are in the workspace
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
  const duration = durationLabel(project.startDate, project.expectedEndDate, t);

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
    ...(startDate ? [{ label: t('plannedStart'), value: startDate }] : []),
    ...(endDate ? [{ label: t('plannedCompletion'), value: endDate }] : []),
    ...(duration ? [{ label: t('duration'), value: duration }] : []),
    ...(project.description ? [{ label: t('description'), value: project.description }] : []),
  ];

  return (
    <RailSection
      id="project-information-title"
      title={t('railProject')}
      action={
        /* Two conditions, and they are different kinds of thing: only a draft accepts edits at
           all (a lifecycle rule), and `PATCH /projects/:id` requires `manage:project` (an
           authorization rule). */
        project.status === 'DRAFT' && can(PROJECT_PERMISSIONS.manage) ? (
          <Link href={`/projects/${project.id}/edit`} className={railLinkClass}>
            {t('edit')}
          </Link>
        ) : null
      }
    >
      <DefinitionList>
        {rows.map((row) => (
          <DefinitionRow key={row.label} label={row.label}>
            {row.value}
          </DefinitionRow>
        ))}
      </DefinitionList>
    </RailSection>
  );
}

/**
 * Planned duration, derived from the two planned dates — nothing new is stored. Whole weeks
 * read as weeks ("4 weeks"); anything else as days, so a 30-day programme is not rounded.
 */
export function durationLabel(
  start: string | null | undefined,
  end: string | null | undefined,
  t: (key: 'durationWeeks' | 'daysCount', values: { count: number }) => string,
): string | null {
  if (!start || !end) return null;
  const days = Math.round((new Date(end).getTime() - new Date(start).getTime()) / 86_400_000);
  if (!Number.isFinite(days) || days <= 0) return null;
  return days % 7 === 0
    ? t('durationWeeks', { count: days / 7 })
    : t('daysCount', { count: days });
}

// ─── Commercial ───────────────────────────────────────────────────────────────

/**
 * The commercial facts a project stands on, separated from its identity because they are
 * configuration and state rather than what the project is.
 *
 * Absence is stated in business terms ("Not created"), not as a dash. Contract value follows the
 * money-visibility rule (ADR-029): a reader the server hides it from (`financialsVisible: false`,
 * `contractValue: null`) sees the lock-and-dash hidden state — never `$0.00`, never a blank.
 * There is no currency row: ACCO is USD-only (ADR-024) and the figure itself says so.
 */
function CommercialFoundation({
  project,
  summary,
}: {
  project: ProjectDetailModel;
  summary: ProjectWorkspaceSummary | undefined;
}) {
  const t = useTranslations('platform.projects.detail');
  const tProjects = useTranslations('platform.projects');
  const { can } = usePermissions();
  // Commercial is a gated tab; a link into it for someone who cannot open it is a 403 dead-end.
  const canOpenCommercial = can('view:contract');

  const setup = summary?.setup;
  const mainContract = summary?.mainContract ?? null;
  const contractApplicable = project.commercialModel !== 'INTERNAL_CAPITAL';
  const financialsVisible = summary?.financialsVisible ?? false;

  // Status words from the BOQ-version vocabulary of the status registry, so "Committed" here is
  // the same colour it is on the BOQ tab.
  const boq = !setup
    ? null
    : setup.boqBaselined
      ? { status: 'COMMITTED', label: t('boqBaselined') }
      : setup.boqExists
        ? { status: 'DRAFT', label: t('boqWorking') }
        : { status: 'DRAFT', label: t('boqStateNotStarted') };

  return (
    <RailSection
      id="project-commercial-title"
      title={t('railCommercial')}
      action={
        canOpenCommercial ? (
          <Link href={`/projects/${project.id}/commercial/overview`} className={railLinkClass}>
            {t('openLink')}
          </Link>
        ) : null
      }
    >
      <DefinitionList>
        <DefinitionRow label={t('commercialModel')}>
          {tProjects(
            `create.commercialModel.${project.commercialModel === 'INTERNAL_CAPITAL' ? 'internalCapital' : 'clientContract'}`,
          )}
        </DefinitionRow>
        <DefinitionRow label={t('boqStatus')}>
          {boq ? (
            <StatusPill tone={statusTone(boq.status, 'boqVersion')}>{boq.label}</StatusPill>
          ) : null}
        </DefinitionRow>
        <DefinitionRow label={t('mainContract')}>
          {!contractApplicable ? (
            t('notApplicable')
          ) : mainContract ? (
            canOpenCommercial ? (
              // Straight to the page that holds the contract, not a route that redirects to it.
              <Link
                href={`/projects/${project.id}/commercial/contract-milestones`}
                className="font-medium text-brand-primary hover:underline"
              >
                {mainContract.contractNumber}
              </Link>
            ) : (
              mainContract.contractNumber
            )
          ) : (
            t('notCreated')
          )}
        </DefinitionRow>
        {/* Only once a contract exists to give the figure meaning. */}
        {mainContract ? (
          <DefinitionRow label={t('contractValue')} numeric>
            <MoneyDisplay
              value={financialsVisible ? mainContract.contractValue : null}
              hidden={!financialsVisible}
              hiddenLabel={t('hiddenByPermission')}
            />
          </DefinitionRow>
        ) : null}
      </DefinitionList>
    </RailSection>
  );
}

// ─── Latest activity ──────────────────────────────────────────────────────────

/**
 * The three latest things that happened to this project: who, what, when. Compact on purpose —
 * no machine codes (the label catalog falls back to "Contract changed" and the like).
 *
 * "View all" opens the project's own history (`GET /projects/:id/activity`) in a side sheet for
 * every project member; the server filters it to what the reader may see. It used to link to the
 * organisation audit log, which only `view:audit-log` holders could open.
 */
function RecentActivity({
  projectId,
  summary,
}: {
  projectId: string;
  summary: ProjectWorkspaceSummary | undefined;
}) {
  const t = useTranslations('platform.projects.detail');
  const [historyOpen, setHistoryOpen] = useState(false);

  if (!summary) return null;

  const events = summary.recentActivity.slice(0, 3);

  return (
    <RailSection
      id="project-activity-title"
      title={t('latestActivity')}
      action={
        events.length > 0 ? (
          <button
            type="button"
            className={railLinkClass}
            aria-haspopup="dialog"
            onClick={() => setHistoryOpen(true)}
          >
            {/* The size sits on the label: globals.css gives <button> `font: inherit`, unlayered,
                which outranks the text utility on the button itself. */}
            <span className="text-caption">{t('viewAll')}</span>
          </button>
        ) : null
      }
    >
      {events.length > 0 ? (
        <div className="mt-3">
          <ActivityList events={events} />
        </div>
      ) : (
        <p className="mt-3 text-caption text-muted-foreground">{t('noRecentActivity')}</p>
      )}
      <ProjectActivitySheet
        projectId={projectId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </RailSection>
  );
}
