'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';

import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useProject } from '@/features/projects/hooks/use-project';
import { formatMoney } from '@/lib/format';

interface ProjectWorkspaceShellProps {
  id: string;
  children: React.ReactNode;
}

export function ProjectWorkspaceShell({ id, children }: ProjectWorkspaceShellProps) {
  const t = useTranslations('platform.projects');
  const locale = useLocale() as 'en' | 'ar';
  const pathname = usePathname();

  const { data: project, isPending } = useProject(id);

  type EnabledTab = { label: string; href: string; overviewTab: boolean };
  type DisabledTab = { label: string; disabled: true };
  type WorkspaceTab = EnabledTab | DisabledTab;

  const tabs: WorkspaceTab[] = [
    { label: t('workspace.overview'), href: `/projects/${id}`, overviewTab: true },
    { label: t('workspace.boq'), href: `/projects/${id}/boq`, overviewTab: false },
    { label: t('workspace.contracts'), href: `/projects/${id}/contracts`, overviewTab: false },
    { label: t('workspace.finance'), disabled: true },
    { label: t('workspace.members'), href: `/projects/${id}/members`, overviewTab: false },
  ];

  function isActiveTab(href: string, overviewTab: boolean): boolean {
    if (overviewTab) {
      // Overview is active on the project root and its edit sub-page.
      return pathname === href || pathname === `/projects/${id}/edit`;
    }
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  const displayName = project
    ? locale === 'ar' && project.nameAr
      ? project.nameAr
      : project.name
    : null;

  return (
    <div>
      {/* ── Health strip ──────────────────────────────────── */}
      <div className="mb-6">
        <Link
          href="/projects"
          className="inline-flex min-h-9 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary focus-visible:rounded"
        >
          <ChevronStartIcon />
          {t('detail.backToList')}
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {isPending ? (
              <div className="space-y-2" aria-hidden="true">
                <div className="h-4 w-24 animate-pulse rounded bg-muted" />
                <div className="h-7 w-56 animate-pulse rounded bg-muted" />
              </div>
            ) : project ? (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{project.code}</span>
                  <ProjectStatusBadge status={project.status} />
                </div>
                <h1 className="mt-1 truncate text-2xl font-semibold tracking-tight text-foreground">
                  {displayName}
                </h1>
              </>
            ) : null}
          </div>

          {project?.contractValue ? (
            <p className="shrink-0 text-sm font-medium text-muted-foreground">
              {formatMoney(project.contractValue, project.currency, locale)}
            </p>
          ) : null}
        </div>

        {/* ── Workspace tab nav ─────────────────────────────── */}
        <nav aria-label={t('workspace.navLabel')} className="mt-4 border-b border-border">
          <div className="-mb-px flex overflow-x-auto">
            {tabs.map((tab) => {
              if ('disabled' in tab) {
                return (
                  <span
                    key={tab.label}
                    aria-disabled="true"
                    className="inline-flex min-h-10 cursor-not-allowed select-none items-center border-b-2 border-transparent px-4 text-sm font-medium whitespace-nowrap text-muted-foreground/40"
                  >
                    {tab.label}
                  </span>
                );
              }

              const enabledTab = tab as EnabledTab;
              const active = isActiveTab(enabledTab.href, enabledTab.overviewTab);

              return (
                <Link
                  key={enabledTab.label}
                  href={enabledTab.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex min-h-10 items-center border-b-2 px-4 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary',
                    active
                      ? 'border-brand-primary text-brand-primary'
                      : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {enabledTab.label}
                </Link>
              );
            })}
          </div>
        </nav>
      </div>

      {/* ── Page content ──────────────────────────────────── */}
      {children}
    </div>
  );
}

function ChevronStartIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}
