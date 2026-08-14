'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { ProjectStatus } from '@erp/types';
import {
  Alert,
  Button,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@erp/ui';
import {
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  FileCheck2,
  FileText,
  LayoutDashboard,
  MapPin,
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
  ProjectStatus.APPROVED,
  ProjectStatus.MOBILIZING,
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
    { key: 'team', label: t('workspace.team'), href: `/projects/${id}/members`, icon: Users },
  ];
  const commercialTabs = [
    { label: t('workspace.contracts'), href: `/projects/${id}/contracts`, icon: FileText },
    {
      label: t('workspace.applicationsCertificates'),
      href: `/projects/${id}/ipc`,
      icon: FileCheck2,
    },
    { label: t('workspace.finance'), href: `/projects/${id}/pl`, icon: Wallet },
  ];
  const mobileTabs = [primaryTabs[0], primaryTabs[1], ...commercialTabs, primaryTabs[2]];

  function isActive(href: string): boolean {
    if (href === `/projects/${id}`) return pathname === href || pathname === `${href}/edit`;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const commercialActive = commercialTabs.some((tab) => isActive(tab.href));
  const isOverview = isActive(`/projects/${id}`);

  // The last breadcrumb used to read "Overview" on every tab, so the BOQ page announced
  // itself as the overview. Derive it from whichever tab is actually active.
  const activeCrumb =
    [...primaryTabs, ...commercialTabs].find((tab) => isActive(tab.href))?.label ??
    t('workspace.overview');
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
        className="mb-4 flex min-h-8 items-center gap-2 text-body-sm text-muted-foreground"
      >
        <Link href="/projects" className="hover:text-foreground">
          {t('title')}
        </Link>
        <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
        <span className="max-w-72 truncate">{project?.name ?? t('workspace.loadingProject')}</span>
        <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
        <span className="font-medium text-foreground">{activeCrumb}</span>
      </nav>

      <section className="mb-5 overflow-hidden border-y border-border bg-surface">
        <div className="px-1 py-4 sm:px-4 sm:py-5">
          {projectQuery.isPending ? (
            <div className="space-y-3" role="status" aria-label={t('workspace.loadingProject')}>
              <div className="h-12 w-12 animate-pulse rounded-panel bg-muted" />
              <div className="h-7 w-64 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ) : project ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-panel border border-border bg-surface-subtle text-foreground">
                    <Building2 size={25} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-h1 font-bold leading-tight text-foreground">
                        {project.name}
                      </h1>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    <p className="mt-1 text-body-sm text-muted-foreground">
                      {project.code} {' / '}{' '}
                      {t(
                        `create.commercialModel.${project.commercialModel === 'INTERNAL_CAPITAL' ? 'internalCapital' : 'clientContract'}`,
                      )}
                    </p>
                    {project.clientName || project.location ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                        {project.location ? (
                          <span className="inline-flex items-center gap-1.5">
                            <MapPin size={15} aria-hidden="true" />
                            {project.location}
                          </span>
                        ) : null}
                        {project.clientName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <UserRound size={15} aria-hidden="true" />
                            {project.clientName}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div id="project-header-actions" className="flex items-center" />
              </div>

              {project.status !== ProjectStatus.CANCELLED && stageIndex >= 0 ? (
                <div className="mt-5 overflow-x-auto border-t border-border px-1 pt-4 [-webkit-overflow-scrolling:touch] sm:px-3">
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
            value={mobileTabs.find((tab) => isActive(tab.href))?.href ?? `/projects/${id}`}
            onChange={(event) => router.push(event.target.value)}
          >
            {mobileTabs.map((tab) => (
              <option key={tab.href} value={tab.href}>
                {tab.label}
              </option>
            ))}
          </select>

          <div className="hidden items-center md:flex">
            {primaryTabs.slice(0, 2).map((tab) => (
              <WorkspaceLink
                key={tab.href}
                label={tab.label}
                href={tab.href}
                icon={tab.icon}
                active={isActive(tab.href)}
              />
            ))}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex min-h-12 items-center gap-2 border-b-2 px-4 text-body-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
                    commercialActive
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground',
                  )}
                >
                  <BriefcaseBusiness size={17} aria-hidden="true" />
                  {t('workspace.commercial')}
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                {commercialTabs.map((tab) => {
                  const Icon = tab.icon;
                  return (
                    <DropdownMenuItem key={tab.href} asChild className="min-h-11">
                      <Link href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}>
                        <Icon size={17} aria-hidden="true" />
                        <span>{tab.label}</span>
                        {isActive(tab.href) ? (
                          <Check
                            size={15}
                            className="ms-auto text-brand-primary"
                            aria-hidden="true"
                          />
                        ) : null}
                      </Link>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <WorkspaceLink
              label={primaryTabs[2].label}
              href={primaryTabs[2].href}
              icon={primaryTabs[2].icon}
              active={isActive(primaryTabs[2].href)}
            />
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
        'inline-flex min-h-12 items-center gap-2 border-b-2 px-4 text-body-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
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
  return (
    <>
      <div className="grid gap-3 sm:hidden">
        <div>
          <p className="text-micro font-semibold uppercase text-muted-foreground">
            {t('workspace.currentStage')}
          </p>
          <p className="mt-1 text-body-sm font-semibold text-brand-primary">
            {t(`status.${stages[current]}`)}
          </p>
        </div>
        <div className="flex justify-between gap-4 text-caption text-muted-foreground">
          <span>{current > 0 ? t(`status.${stages[current - 1]}`) : ''}</span>
          <span>{current < stages.length - 1 ? t(`status.${stages[current + 1]}`) : ''}</span>
        </div>
      </div>
      {/* Green for stages already passed, blue for the one in progress, grey for the rest.
          The whole strip used to be brand blue up to the current stage, which meant the
          colour said "brand" rather than "done" — and blue is the interactive colour
          everywhere else in the product. See the semantics table in frontend-theme.md. */}
      <div className="hidden min-w-max items-start sm:flex">
        {stages.map((stage, index) => {
          const complete = index < current;
          const active = index === current;

          return (
            <div key={stage} className="flex items-start">
              <div className="flex w-24 flex-col items-center gap-1.5 lg:w-28">
                <div
                  title={t(`status.${stage}`)}
                  className={cn(
                    'flex h-5 w-5 items-center justify-center rounded-full',
                    active && 'bg-brand-primary ring-4 ring-brand-primary/15',
                    complete && 'bg-success',
                    !complete && !active && 'border border-border bg-surface',
                  )}
                >
                  {complete ? (
                    <Check size={11} strokeWidth={3} className="text-white" aria-hidden="true" />
                  ) : null}
                  {active ? (
                    <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" />
                  ) : null}
                </div>
                <span
                  className={cn(
                    'text-center text-micro font-medium leading-4',
                    active && 'text-brand-primary',
                    complete && 'text-success',
                    !complete && !active && 'text-muted-foreground',
                  )}
                >
                  {t(`status.${stage}`)}
                </span>
              </div>
              {index < stages.length - 1 ? (
                <div
                  className={cn(
                    'mt-2.5 h-px w-4 lg:w-6',
                    // The connector belongs to the stage behind it: green once passed.
                    complete ? 'bg-success' : 'bg-border',
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
