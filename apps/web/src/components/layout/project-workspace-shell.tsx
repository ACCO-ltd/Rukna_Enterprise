'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';
import { ProjectStatus } from '@erp/types';
import { cn } from '@erp/ui';
import {
  Archive,
  ArrowLeft,
  Check,
  ChartLine as LineChart,
  ClipboardList,
  Clock3,
  CircleDollarSign,
  DollarSign,
  FileText,
  Folder,
  ShoppingCart,
  LayoutDashboard,
  Users,
} from 'lucide-react';

import { formatMoney } from '@/lib/format';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useProject } from '@/features/projects/hooks/use-project';

interface ProjectWorkspaceShellProps {
  id: string;
  children: React.ReactNode;
}

/** Forward lifecycle order, excluding the terminal-branch CANCELLED. */
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

  const { data: project, isPending } = useProject(id);

  type TabConfig = {
    key: string;
    label: string;
    href: string;
    overviewTab: boolean;
    icon: typeof LayoutDashboard;
    enabled: boolean;
  };

  const allTabs: TabConfig[] = [
    { key: 'overview', label: t('workspace.overview'), href: `/projects/${id}`, overviewTab: true, icon: LayoutDashboard, enabled: true },
    { key: 'contracts', label: t('workspace.contracts'), href: `/projects/${id}/contracts`, overviewTab: false, icon: FileText, enabled: true },
    { key: 'boq', label: t('workspace.boq'), href: `/projects/${id}/boq`, overviewTab: false, icon: ClipboardList, enabled: true },
    { key: 'team', label: t('workspace.team'), href: `/projects/${id}/members`, overviewTab: false, icon: Users, enabled: true },
    { key: 'procurement', label: 'Procurement', href: `/projects/${id}/procurement`, overviewTab: false, icon: ShoppingCart, enabled: false },
    { key: 'inventory', label: 'Inventory', href: `/projects/${id}/inventory`, overviewTab: false, icon: Archive, enabled: false },
    { key: 'progress', label: 'Progress', href: `/projects/${id}/progress`, overviewTab: false, icon: LineChart, enabled: false },
    { key: 'ipc', label: t('workspace.ipc'), href: `/projects/${id}/ipc`, overviewTab: false, icon: CircleDollarSign, enabled: true },
    { key: 'finance', label: t('workspace.finance'), href: `/projects/${id}/finance`, overviewTab: false, icon: DollarSign, enabled: false },
    { key: 'documents', label: 'Documents', href: `/projects/${id}/documents`, overviewTab: false, icon: Folder, enabled: false },
    { key: 'activity', label: 'Activity', href: `/projects/${id}/activity`, overviewTab: false, icon: Clock3, enabled: false },
  ];

  const tabs = allTabs.filter((tab) => tab.enabled);

  function isActiveTab(href: string, overviewTab: boolean): boolean {
    if (overviewTab) {
      return pathname === href || pathname === `/projects/${id}/edit`;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const contractValue = project
    ? formatMoney(project.contractValue, project.currency, locale)
    : null;

  const stageIndex =
    project?.status ? LIFECYCLE_STAGES.indexOf(project.status) : -1;

  const isCancelled = project?.status === ProjectStatus.CANCELLED;

  return (
    <div>
      {/* ── Back link ─────────────────────────────────────────── */}
      <div className="mb-4">
        <Link
          href="/projects"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:rounded"
        >
          <ArrowLeft size={15} className="rtl:rotate-180" aria-hidden="true" />
          {t('detail.backToList')}
        </Link>
      </div>

      {/* ── Project header card ───────────────────────────────── */}
      <div className="mb-6 overflow-hidden rounded-lg border border-border bg-surface shadow-[var(--shadow-panel)]">
        <div className="px-5 pt-5 sm:px-6 sm:pt-6">
          {isPending ? (
            <div className="space-y-2 py-2" aria-hidden="true">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
              <div className="h-7 w-56 animate-pulse rounded bg-muted" />
              <div className="h-3 w-36 animate-pulse rounded bg-muted" />
            </div>
          ) : project ? (
            <>
              {/* Top row: code + badge ← → contract value */}
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-medium text-muted-foreground">
                    {project.code}
                  </span>
                  <ProjectStatusBadge status={project.status} />
                </div>

                <div className="flex flex-wrap items-center justify-end gap-3">
                  {contractValue ? (
                    <div className="rounded-lg bg-surface-subtle px-3 py-2 text-end">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {t('detail.contractValue')}
                      </span>
                      <span className="mt-0.5 block text-sm font-semibold tabular-nums text-foreground">
                        {contractValue}
                      </span>
                    </div>
                  ) : null}
                  <div id="project-header-actions" className="flex items-center" />
                </div>
              </div>

              {/* Project name */}
              <h1 className="mt-3 text-[25px] font-bold leading-tight text-foreground sm:text-[28px]">
                {project.name}
              </h1>

              {/* Client · location */}
              {(project.clientName || project.location) ? (
                <p className="mt-1 text-sm text-muted-foreground">
                  {[project.clientName, project.location].filter(Boolean).join(' · ')}
                </p>
              ) : null}

              {/* Lifecycle progress strip */}
              {!isCancelled && stageIndex >= 0 ? (
                <div className="mt-5 overflow-x-auto rounded-xl bg-surface-subtle px-4 py-3 [-webkit-overflow-scrolling:touch]">
                  <LifecycleStrip
                    stages={LIFECYCLE_STAGES}
                    current={stageIndex}
                    t={t}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        {/* ── Workspace tab nav ─────────────────────────────── */}
        <nav
          aria-label={t('workspace.navLabel')}
          className="mt-4 border-t border-border"
        >
          {/* Mobile: select */}
          <label className="sr-only" htmlFor="project-workspace-menu">
            {t('workspace.navLabel')}
          </label>
          <select
            id="project-workspace-menu"
            className="mx-5 mb-3 mt-3 min-h-11 w-[calc(100%-2.5rem)] rounded-md border border-border bg-surface px-3 text-sm font-medium text-foreground md:hidden"
            value={
              tabs.find((tab) => isActiveTab(tab.href, tab.overviewTab))?.href ??
              `/projects/${id}`
            }
            onChange={(event) => router.push(event.target.value)}
          >
            {tabs.map((tab) => (
              <option key={tab.href} value={tab.href}>
                {tab.label}
              </option>
            ))}
          </select>

          {/* Desktop: tab strip */}
          <div className="-mb-px hidden overflow-x-auto px-2 md:flex">
            {tabs.map((tab) => {
              const active = isActiveTab(tab.href, tab.overviewTab);
              const TabIcon = tab.icon;
              return (
                <Link
                  key={tab.label}
                  href={tab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-[3rem] items-center gap-2 border-b-2 px-4 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-200',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
                    active
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  <TabIcon size={17} strokeWidth={active ? 2.4 : 1.8} aria-hidden="true" />
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* ── Tab content ───────────────────────────────────────── */}
      {children}
    </div>
  );
}

// ─── Lifecycle progress strip ─────────────────────────────────────────────────

interface LifecycleStripProps {
  stages: ProjectStatus[];
  current: number;
  t: ReturnType<typeof useTranslations<'platform.projects'>>;
}

function LifecycleStrip({ stages, current, t }: LifecycleStripProps) {
  return (
    <div className="flex min-w-max items-center gap-0">
      {stages.map((stage, index) => {
        const isPast = index < current;
        const isCurrent = index === current;
        const isLast = index === stages.length - 1;

        return (
          <div key={stage} className="flex items-center">
            {/* Dot */}
            <div className="relative flex flex-col items-center gap-1.5">
              <div
                title={t(`status.${stage}`)}
                className={cn(
                  'flex h-5 w-5 items-center justify-center rounded-full transition-all duration-200',
                  isCurrent && 'ring-4 ring-brand-primary/15',
                  isPast || isCurrent
                    ? 'bg-brand-primary'
                    : 'border border-border bg-surface',
                )}
              >
                {isPast ? <Check size={11} strokeWidth={3} className="text-white" aria-hidden="true" /> : null}
                {isCurrent ? <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden="true" /> : null}
              </div>
              {/* Label */}
              <span
                className={cn(
                  'max-w-[5.5rem] truncate text-center text-[10.5px] font-medium leading-none',
                  isCurrent ? 'text-brand-primary' : isPast ? 'text-muted-foreground' : 'text-muted-foreground/50',
                )}
              >
                {t(`status.${stage}`)}
              </span>
            </div>

            {/* Connector line */}
            {!isLast ? (
              <div
                className={cn(
                  'mb-3.5 h-px w-8 flex-shrink-0',
                  index < current ? 'bg-brand-primary' : 'bg-border',
                )}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────
