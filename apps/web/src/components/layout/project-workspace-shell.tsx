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
  ArrowLeft,
  BriefcaseBusiness,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ClipboardList,
  FileCheck2,
  FileText,
  LayoutDashboard,
  MapPin,
  UserRound,
  Users,
} from 'lucide-react';

import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useProject, useProjectWorkspaceSummary } from '@/features/projects/hooks/use-project';
import { formatDate, formatMoney } from '@/lib/format';

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
    { key: 'overview', label: t('workspace.overview'), href: `/projects/${id}`, icon: LayoutDashboard },
    { key: 'boq', label: t('workspace.scope'), href: `/projects/${id}/boq`, icon: ClipboardList },
    { key: 'team', label: t('workspace.team'), href: `/projects/${id}/members`, icon: Users },
  ];
  const commercialTabs = [
    { label: t('workspace.contracts'), href: `/projects/${id}/contracts`, icon: FileText },
    { label: t('workspace.applicationsCertificates'), href: `/projects/${id}/ipc`, icon: FileCheck2 },
  ];
  const mobileTabs = [primaryTabs[0], primaryTabs[1], ...commercialTabs, primaryTabs[2]];

  function isActive(href: string): boolean {
    if (href === `/projects/${id}`) return pathname === href || pathname === `${href}/edit`;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const commercialActive = commercialTabs.some((tab) => isActive(tab.href));
  const mainContract = summaryQuery.data?.mainContract;
  const contractValue = mainContract?.contractValue
    ? formatMoney(mainContract.contractValue, mainContract.currency, locale)
    : null;
  const programme = project?.startDate || project?.expectedEndDate
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
        <Button variant="outline" size="sm" onClick={() => projectQuery.refetch()}>{t('retry')}</Button>
      </div>
    );
  }

  return (
    <div>
      <Link
        href="/projects"
        className="mb-3 inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
      >
        <ArrowLeft size={15} className="rtl:rotate-180" aria-hidden="true" />
        {t('detail.backToList')}
      </Link>

      <section className="mb-6 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="p-5 sm:p-6">
          {projectQuery.isPending ? (
            <div className="space-y-3" role="status" aria-label={t('workspace.loadingProject')}>
              <div className="h-12 w-12 animate-pulse rounded-lg bg-muted" />
              <div className="h-7 w-64 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ) : project ? (
            <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3.5">
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-subtle text-foreground">
                    <Building2 size={25} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h1 className="text-2xl font-bold leading-tight text-foreground sm:text-[28px]">{project.name}</h1>
                      <ProjectStatusBadge status={project.status} />
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {project.code} · {t(`create.commercialModel.${project.commercialModel === 'INTERNAL_CAPITAL' ? 'internalCapital' : 'clientContract'}`)}
                    </p>
                    {project.clientName || project.location ? (
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                        {project.location ? <span className="inline-flex items-center gap-1.5"><MapPin size={15} aria-hidden="true" />{project.location}</span> : null}
                        {project.clientName ? <span className="inline-flex items-center gap-1.5"><UserRound size={15} aria-hidden="true" />{project.clientName}</span> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                <div id="project-header-actions" className="flex items-center" />
              </div>

              {project.status !== ProjectStatus.CANCELLED && stageIndex >= 0 ? (
                <div className="mt-5 overflow-x-auto rounded-lg bg-surface-subtle px-4 py-3 [-webkit-overflow-scrolling:touch]">
                  <LifecycleStrip stages={LIFECYCLE_STAGES} current={stageIndex} t={t} />
                </div>
              ) : null}

              <dl className="mt-5 grid overflow-hidden rounded-lg border border-border sm:grid-cols-2 lg:grid-cols-4">
                <SummaryItem icon={BriefcaseBusiness} label={t('workspace.mainContract')} value={summaryQuery.isPending ? t('workspace.loadingValue') : contractValue ?? (project.commercialModel === 'INTERNAL_CAPITAL' ? t('workspace.notApplicable') : summaryQuery.data?.mainContract && !summaryQuery.data.financialsVisible ? t('workspace.restricted') : t('workspace.notCreated'))} />
                <SummaryItem icon={CalendarDays} label={t('workspace.programme')} value={programme ?? t('detail.notSet')} />
                <SummaryItem icon={UserRound} label={t('workspace.projectManager')} value={projectManagerName ?? t('detail.notSet')} />
                <SummaryItem icon={Building2} label={t('workspace.currentStage')} value={t(`status.${project.status}`)} />
              </dl>
            </>
          ) : null}
        </div>

        <nav aria-label={t('workspace.navLabel')} className="border-t border-border">
          <label className="sr-only" htmlFor="project-workspace-menu">{t('workspace.navLabel')}</label>
          <select
            id="project-workspace-menu"
            className="mx-5 my-3 min-h-11 w-[calc(100%-2.5rem)] rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground md:hidden"
            value={mobileTabs.find((tab) => isActive(tab.href))?.href ?? `/projects/${id}`}
            onChange={(event) => router.push(event.target.value)}
          >
            {mobileTabs.map((tab) => <option key={tab.href} value={tab.href}>{tab.label}</option>)}
          </select>

          <div className="hidden items-center px-2 md:flex">
            {primaryTabs.slice(0, 2).map((tab) => <WorkspaceLink key={tab.href} label={tab.label} href={tab.href} icon={tab.icon} active={isActive(tab.href)} />)}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex min-h-12 items-center gap-2 border-b-2 px-4 text-[13.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
                    commercialActive ? 'border-brand-primary text-brand-primary' : 'border-transparent text-muted-foreground hover:text-foreground',
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
                  return <DropdownMenuItem key={tab.href} asChild className="min-h-11"><Link href={tab.href} aria-current={isActive(tab.href) ? 'page' : undefined}><Icon size={17} aria-hidden="true" /><span>{tab.label}</span>{isActive(tab.href) ? <Check size={15} className="ms-auto text-brand-primary" aria-hidden="true" /> : null}</Link></DropdownMenuItem>;
                })}
              </DropdownMenuContent>
            </DropdownMenu>
            <WorkspaceLink label={primaryTabs[2].label} href={primaryTabs[2].href} icon={primaryTabs[2].icon} active={isActive(primaryTabs[2].href)} />
          </div>
        </nav>
      </section>

      {summaryQuery.isError ? <div className="mb-4"><Alert variant="warning" messages={[t('workspace.contractSummaryUnavailable')]} /></div> : null}
      {children}
    </div>
  );
}

function SummaryItem({ icon: Icon, label, value }: { icon: typeof Building2; label: string; value: string }) {
  return (
    <div className="border-b border-border p-4 last:border-b-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:odd:border-e lg:border-b-0 lg:not-last:border-e">
      <dt className="flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground"><Icon size={15} aria-hidden="true" />{label}</dt>
      <dd className="mt-2 truncate text-sm font-semibold text-foreground" title={value}>{value}</dd>
    </div>
  );
}

function WorkspaceLink({ label, href, icon: Icon, active }: { label: string; href: string; icon: typeof LayoutDashboard; active: boolean }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={cn('inline-flex min-h-12 items-center gap-2 border-b-2 px-4 text-[13.5px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary', active ? 'border-brand-primary text-brand-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
      <Icon size={17} strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />{label}
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
    <div className="flex min-w-max items-center">
      {stages.map((stage, index) => (
        <div key={stage} className="flex items-center">
          <div className="flex flex-col items-center gap-1.5">
            <div title={t(`status.${stage}`)} className={cn('flex h-5 w-5 items-center justify-center rounded-full', index === current && 'ring-4 ring-brand-primary/15', index <= current ? 'bg-brand-primary' : 'border border-border bg-surface')}>
              {index < current ? <Check size={11} strokeWidth={3} className="text-white" aria-hidden="true" /> : null}
              {index === current ? <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" /> : null}
            </div>
            <span className={cn('max-w-[6rem] truncate text-center text-[10.5px] font-medium', index === current ? 'text-brand-primary' : 'text-muted-foreground')}>{t(`status.${stage}`)}</span>
          </div>
          {index < stages.length - 1 ? <div className={cn('mb-4 h-px w-8', index < current ? 'bg-brand-primary' : 'bg-border')} /> : null}
        </div>
      ))}
    </div>
  );
}
