'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { ProjectStatus } from '@erp/types';
import {
  Alert,
  Button,
  cn,
} from '@erp/ui';
import {
  Activity,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronRight,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  MapPin,
  ShoppingCart,
  UserRound,
  Users,
  Wallet,
} from 'lucide-react';

import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useProject, useProjectWorkspaceSummary } from '@/features/projects/hooks/use-project';
import { formatDate } from '@/lib/format';

interface ProjectWorkspaceShellProps {
  id: string;
  children: React.ReactNode;
}

const LIFECYCLE_STAGES: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.ACTIVE,
  ProjectStatus.PRACTICAL_COMPLETION,
  ProjectStatus.CLOSEOUT,
  ProjectStatus.CLOSED,
];

export function ProjectWorkspaceShell({ id, children }: ProjectWorkspaceShellProps) {
  const t = useTranslations('platform.projects');
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale() as 'en' | 'ar';
  const projectQuery = useProject(id);
  const summaryQuery = useProjectWorkspaceSummary(id);
  const project = projectQuery.data;

  const primaryTabs = [
    {
      key: 'overview',
      label: t('workspace.overview'),
      href: `/projects/${id}`,
      icon: LayoutDashboard,
    },
    // Named "BOQ", not "Scope". For construction professionals BOQ is the precise term;
    // "Scope" reads as programme, milestones and progress too, which are separate controls
    // living behind a Programme & Progress tab that does not exist yet. See ADR-016.
    { key: 'boq', label: t('workspace.boq'), href: `/projects/${id}/boq`, icon: ClipboardList },
    {
      key: 'progress',
      label: t('workspace.progress'),
      href: `/projects/${id}/progress`,
      icon: Activity,
    },
    // One tab, not a dropdown. Commercial was three flat entries — Contracts, Applications &
    // certificates, Finance — inside the only nested control in this bar, and they duplicated
    // the Commercial workspace's own sub-nav. The contract and certificate routes now live
    // under /commercial/*; Finance is its own tab because accounting truth and client contract
    // administration are different responsibilities.
    {
      key: 'commercial',
      label: t('workspace.commercial'),
      href: `/projects/${id}/commercial`,
      icon: BriefcaseBusiness,
    },
    { key: 'finance', label: t('workspace.finance'), href: `/projects/${id}/pl`, icon: Wallet },
    {
      key: 'procurement',
      label: t('workspace.procurement'),
      href: `/projects/${id}/procurement`,
      icon: ShoppingCart,
    },
    { key: 'team', label: t('workspace.team'), href: `/projects/${id}/members`, icon: Users },
    {
      key: 'documents',
      label: t('workspace.documents'),
      href: `/projects/${id}/documents`,
      icon: FolderOpen,
    },
  ];

  function isActive(href: string): boolean {
    if (href === `/projects/${id}`) return pathname === href || pathname === `${href}/edit`;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const isOverview = isActive(`/projects/${id}`);

  // The last breadcrumb used to read "Overview" on every tab, so the BOQ page announced
  // itself as the overview. Derive it from whichever tab is actually active.
  const activeCrumb =
    primaryTabs.find((tab) => isActive(tab.href))?.label ?? t('workspace.overview');
  const mainContract = summaryQuery.data?.mainContract;
  const programme =
    project?.startDate || project?.expectedEndDate
      ? [formatDate(project.startDate, locale), formatDate(project.expectedEndDate, locale)]
          .filter(Boolean)
          .join(' - ')
      : null;
  const projectManagerName = summaryQuery.data?.responsibility.projectManager?.name ?? null;
  const stageIndex = project?.status ? LIFECYCLE_STAGES.indexOf(project.status) : -1;

  if (projectQuery.isError) {
    return (
      <div className="space-y-3">
        <Alert
          variant="error"
          title={t('detail.loadFailed')}
          messages={[t('workspace.loadFailedHint')]}
        />
        <Button variant="outline" size="sm" onClick={() => projectQuery.refetch()}>
          {t('retry')}
        </Button>
      </div>
    );
  }

  return (
    <div>
      <nav
        aria-label={t('workspace.breadcrumbLabel')}
        className="mb-3 flex min-h-8 items-center gap-2 text-body-sm text-muted-foreground"
      >
        <Link href="/projects" className="hover:text-foreground">
          {t('title')}
        </Link>
        <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
        {/* The one crumb that should navigate and did not. Only rendered as a link once the
            project has loaded — a link to a record we cannot name yet is not a way back. */}
        {project ? (
          <Link href={`/projects/${id}`} className="max-w-72 truncate hover:text-foreground">
            {project.name}
          </Link>
        ) : (
          <span className="max-w-72 truncate">{t('workspace.loadingProject')}</span>
        )}
        <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
        <span className="font-medium text-foreground">{activeCrumb}</span>
      </nav>

      <section className="mb-4 overflow-hidden border-y border-border bg-surface">
        <div className="px-1 py-3 sm:px-4 sm:py-4">
          {projectQuery.isPending ? (
            <div className="space-y-3" role="status" aria-label={t('workspace.loadingProject')}>
              <div className="h-12 w-12 animate-pulse rounded-panel bg-muted" />
              <div className="h-7 w-64 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ) : project ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-panel border border-border bg-surface-subtle text-foreground">
                    <Building2 size={20} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-h1 font-bold leading-tight text-foreground">
                        {project.name}
                      </h1>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    {/* One meta line: CODE · model · client · location, `·`-separated, empties
                        dropped. Previously a `code / model` line plus a separate location·client
                        caption row — two rows collapsed to one to reclaim vertical space. */}
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-body-sm text-muted-foreground">
                      <span>{project.code}</span>
                      <span aria-hidden="true">·</span>
                      <span>
                        {t(
                          `create.commercialModel.${project.commercialModel === 'INTERNAL_CAPITAL' ? 'internalCapital' : 'clientContract'}`,
                        )}
                      </span>
                      {project.clientName ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <UserRound size={14} aria-hidden="true" />
                            {project.clientName}
                          </span>
                        </>
                      ) : null}
                      {project.location ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <MapPin size={14} aria-hidden="true" />
                            {project.location}
                          </span>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div id="project-header-actions" className="flex items-center" />
              </div>

              {project.status !== ProjectStatus.CANCELLED && stageIndex >= 0 ? (
                <div className="mt-3 overflow-x-auto [-webkit-overflow-scrolling:touch]">
                  <LifecycleStrip stages={LIFECYCLE_STAGES} current={stageIndex} t={t} />
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <nav aria-label={t('workspace.navLabel')} className="border-t border-border">
          <label className="sr-only" htmlFor="project-workspace-menu">
            {t('workspace.navLabel')}
          </label>
          <select
            id="project-workspace-menu"
            className="mx-5 my-3 min-h-11 w-[calc(100%-2.5rem)] rounded-control border border-border bg-surface px-3 text-sm font-medium text-foreground md:hidden"
            value={primaryTabs.find((tab) => isActive(tab.href))?.href ?? `/projects/${id}`}
            onChange={(event) => router.push(event.target.value)}
          >
            {primaryTabs.map((tab) => (
              <option key={tab.href} value={tab.href}>
                {tab.label}
              </option>
            ))}
          </select>

          {/* Eight peers, no nesting. Every tab leads to a workspace that exists. */}
          <div className="hidden items-center md:flex">
            {primaryTabs.map((tab) => (
              <WorkspaceLink
                key={tab.href}
                label={tab.label}
                href={tab.href}
                icon={tab.icon}
                active={isActive(tab.href)}
              />
            ))}
          </div>
        </nav>

        {/* Overview only.

            These four are the project's headline facts, and Overview is where someone goes
            to read them. On a working tab they are a second, competing tile row above the
            one the feature brought — on BOQ that meant eight visually identical boxes and no
            complete BOQ row above the fold at 1440x900. The context is one tab away, and the
            lifecycle strip and header above still say which project this is and where it is
            in its life. */}
        {project && isOverview ? (
          <dl className="grid border-t border-border bg-surface-subtle sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem
              icon={BriefcaseBusiness}
              label={
                project.status === ProjectStatus.DRAFT
                  ? t('workspace.boqBaseline')
                  : t('workspace.mainContract')
              }
              value={
                summaryQuery.isPending
                  ? t('workspace.loadingValue')
                  : project.status === ProjectStatus.DRAFT
                    ? summaryQuery.data?.setup.boqBaselined
                      ? t('workspace.complete')
                      : t('workspace.required')
                    : (mainContract?.contractNumber ??
                      (project.commercialModel === 'INTERNAL_CAPITAL'
                        ? t('workspace.notApplicable')
                        : t('workspace.notCreated')))
              }
              supporting={
                project.commercialModel === 'INTERNAL_CAPITAL'
                  ? t('create.commercialModel.internalCapital')
                  : t('create.commercialModel.clientContract')
              }
            />
            <SummaryItem
              icon={CalendarDays}
              label={
                project.status === ProjectStatus.DRAFT
                  ? t('workspace.mainContract')
                  : t('workspace.programme')
              }
              value={
                project.status === ProjectStatus.DRAFT
                  ? summaryQuery.data?.setup.mainContractExists
                    ? (mainContract?.contractNumber ?? t('workspace.complete'))
                    : summaryQuery.data?.setup.boqBaselined
                      ? t('workspace.required')
                      : t('workspace.blocked')
                  : (programme ?? t('detail.notSet'))
              }
              supporting={
                summaryQuery.data?.programme.daysRemaining == null
                  ? undefined
                  : summaryQuery.data.programme.daysRemaining >= 0
                    ? t('detail.daysCount', { count: summaryQuery.data.programme.daysRemaining })
                    : t('detail.daysOverdueCount', {
                        count: Math.abs(summaryQuery.data.programme.daysRemaining),
                      })
              }
            />
            <SummaryItem
              icon={UserRound}
              label={
                project.status === ProjectStatus.DRAFT
                  ? t('workspace.team')
                  : t('workspace.projectManager')
              }
              value={
                project.status === ProjectStatus.DRAFT
                  ? t('detail.teamMembers', {
                      count: summaryQuery.data?.responsibility.teamCount ?? project.members.length,
                    })
                  : (projectManagerName ?? t('detail.notSet'))
              }
              supporting={
                project.status === ProjectStatus.DRAFT
                  ? t('workspace.setup')
                  : t('workspace.projectManager')
              }
            />
            <SummaryItem
              icon={Building2}
              label={t('workspace.currentStage')}
              value={t(`status.${project.status}`)}
              supporting={
                project.status === ProjectStatus.DRAFT && summaryQuery.data
                  ? t('detail.setupProgress', {
                      done: summaryQuery.data.setup.completedSteps,
                      total: summaryQuery.data.setup.totalSteps,
                    })
                  : undefined
              }
            />
          </dl>
        ) : null}
      </section>

      {summaryQuery.isError ? (
        <div className="mb-4">
          <Alert variant="warning" messages={[t('workspace.contractSummaryUnavailable')]} />
        </div>
      ) : null}
      {children}
    </div>
  );
}

function SummaryItem({
  icon: Icon,
  label,
  value,
  supporting,
}: {
  icon: typeof Building2;
  label: string;
  value: string;
  supporting?: string;
}) {
  return (
    <div className="border-b border-border px-5 py-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
        <Icon size={15} aria-hidden="true" />
        {label}
      </dt>
      <dd className="mt-2 truncate text-sm font-semibold text-foreground" title={value}>
        {value}
      </dd>
      {supporting ? (
        <dd className="mt-1 truncate text-caption text-muted-foreground">{supporting}</dd>
      ) : null}
    </div>
  );
}

function WorkspaceLink({
  label,
  href,
  icon: Icon,
  active,
}: {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'inline-flex min-h-11 items-center gap-2 border-b-2 px-4 text-body-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
        active
          ? 'border-brand-primary text-brand-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon size={17} strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
      {label}
    </Link>
  );
}

interface LifecycleStripProps {
  stages: ProjectStatus[];
  current: number;
  t: ReturnType<typeof useTranslations<'platform.projects'>>;
}

function LifecycleStrip({ stages, current, t }: LifecycleStripProps) {
  // A single-line inline stepper: dot + label on the same line, thin connectors between
  // stages. The parent scrolls this row on narrow screens (overflow-x-auto) so it never
  // wraps and never pushes the page — this one row serves mobile too, replacing the old
  // stacked w-24 columns and the separate sm:hidden current/prev/next summary.
  //
  // Green for stages already passed, blue for the one in progress, grey for the rest.
  // The whole strip used to be brand blue up to the current stage, which meant the
  // colour said "brand" rather than "done" — and blue is the interactive colour
  // everywhere else in the product. See the semantics table in frontend-theme.md.
  return (
    <ol
      aria-label={t('workspace.currentStage')}
      className="flex min-w-max items-center gap-2"
    >
      {stages.map((stage, index) => {
        const complete = index < current;
        const active = index === current;
        const label = t(`status.${stage}`);

        return (
          <li key={stage} className="flex shrink-0 items-center gap-2">
            <div className="flex items-center gap-1.5" aria-current={active ? 'step' : undefined}>
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-4 w-4 shrink-0 items-center justify-center rounded-full',
                  active && 'bg-brand-primary ring-4 ring-brand-primary/15',
                  complete && 'bg-success',
                  !complete && !active && 'border border-border bg-surface',
                )}
              >
                {complete ? (
                  <Check size={10} strokeWidth={3} className="text-white" aria-hidden="true" />
                ) : null}
                {active ? (
                  <span className="h-1 w-1 rounded-full bg-white" aria-hidden="true" />
                ) : null}
              </span>
              <span
                className={cn(
                  'whitespace-nowrap text-caption font-medium leading-none',
                  active && 'font-semibold text-brand-primary',
                  complete && 'text-success',
                  !complete && !active && 'text-muted-foreground',
                )}
              >
                {label}
              </span>
            </div>
            {index < stages.length - 1 ? (
              <span
                aria-hidden="true"
                className={cn(
                  'h-px w-5 shrink-0 lg:w-8',
                  // The connector belongs to the stage behind it: green once passed.
                  complete ? 'bg-success' : 'bg-border',
                )}
              />
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
