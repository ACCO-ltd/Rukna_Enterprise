'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Alert, Button } from '@erp/ui';
import {
  Activity,
  BriefcaseBusiness,
  ChevronRight,
  ClipboardList,
  FolderOpen,
  LayoutDashboard,
  ShoppingCart,
  Users,
  Wallet,
} from 'lucide-react';

import { ProjectActionsPanel } from '@/features/projects/components/project-actions-panel';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useDistricts } from '@/features/districts/hooks/use-districts';
import { useProject, useProjectWorkspaceSummary } from '@/features/projects/hooks/use-project';
import { getAvailableActions } from '@/features/projects/project-actions';
import { formatDate } from '@/lib/format';

import { WorkspaceTabs } from './workspace-tabs';

interface ProjectWorkspaceShellProps {
  id: string;
  children: React.ReactNode;
}

/**
 * The persistent project operating shell.
 *
 * It has four jobs and no others: say which project this is, say what state it is in, offer the
 * one action that state calls for, and navigate between the workspaces underneath. Every project
 * tab renders inside it, so anything that is not one of those four jobs is a tax paid eight
 * times over.
 *
 * Three things used to sit here and no longer do:
 *
 *  - **The building icon.** Every project had the same one, so it encoded nothing while taking
 *    horizontal space and pushing the title out of alignment.
 *  - **The lifecycle strip.** Project stage is project-level context, not BOQ context — someone
 *    editing a BOQ already knows which project they are in. It is now a section on Overview,
 *    which is where a reader goes for the project's own facts. That returns a row of vertical
 *    space to all seven working tabs.
 *  - **The four-tile summary row.** Main contract, programme, physical progress and current
 *    stage: every one of them is now stated once, in the Overview section that owns it
 *    (Commercial foundation, Project information, the progress card, the lifecycle rail).
 *
 * The commercial model left the metadata line for the same reason — it is configuration, not
 * identity, and it reads on Overview under Commercial foundation.
 */
export function ProjectWorkspaceShell({ id, children }: ProjectWorkspaceShellProps) {
  const t = useTranslations('platform.projects');
  const tDetail = useTranslations('platform.projects.detail');
  const pathname = usePathname();
  const locale = useLocale() as 'en' | 'ar';
  const projectQuery = useProject(id);
  const summaryQuery = useProjectWorkspaceSummary(id);
  const project = projectQuery.data;

  // The project carries `districtId`, not the district's name, so the site line is composed
  // here from the registry the picker has already fetched and cached. All districts rather than
  // only active ones: a project built in a district since retired still has to read.
  const { data: districts = [] } = useDistricts(false);
  const districtName = districts.find((d) => d.id === project?.districtId)?.name ?? null;
  // "Hodan, Hotel Sahafi" — the administrative area, then the address inside it, which is the
  // order a site gets given to a driver. Either half stands alone when the other is absent.
  const siteLabel = [districtName, project?.location].filter(Boolean).join(', ');

  // Ordered by the project's operating logic rather than by the order the workspaces shipped:
  // understand → scope → execute → earn → spend → financial position → evidence → people.
  // Procurement sits before Finance because procurement *creates* the commitments, accruals and
  // actuals that Finance then interprets; Documents before Team because project evidence is
  // read daily and membership is changed rarely.
  const primaryTabs = [
    {
      key: 'overview',
      label: t('workspace.overview'),
      href: `/projects/${id}`,
      icon: LayoutDashboard,
    },
    // Named "BOQ", not "Scope" or "Planning". For construction professionals BOQ is the precise
    // term, and the aggregate behind this tab really is a versioned, baselined bill of
    // quantities. "Planning" would be the right name only once programme, work packages and
    // milestones lived under it too. See ADR-016.
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
    {
      key: 'procurement',
      label: t('workspace.procurement'),
      href: `/projects/${id}/procurement`,
      icon: ShoppingCart,
    },
    // The Finance tab used to land on the Project Actual P&L alone — a subset presented as the
    // whole. It now opens the Finance workspace: cost position and control status first, with
    // Cost Control, Profit & Loss and the Ledger beneath it.
    {
      key: 'finance',
      label: t('workspace.finance'),
      href: `/projects/${id}/finance`,
      icon: Wallet,
    },
    {
      key: 'documents',
      label: t('workspace.documents'),
      href: `/projects/${id}/documents`,
      icon: FolderOpen,
    },
    { key: 'team', label: t('workspace.team'), href: `/projects/${id}/members`, icon: Users },
  ];

  function isActive(href: string): boolean {
    if (href === `/projects/${id}`) return pathname === href || pathname === `${href}/edit`;
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  // The last breadcrumb used to read "Overview" on every tab, so the BOQ page announced
  // itself as the overview. Derive it from whichever tab is actually active.
  const activeCrumb =
    primaryTabs.find((tab) => isActive(tab.href))?.label ?? t('workspace.overview');

  // A suspension blocks every lifecycle command, so it belongs to the shell rather than to
  // Overview: the Resume button now follows the reader onto BOQ and Procurement, and a Resume
  // button with its explanation one tab away is worse than no banner at all.
  const suspension = project?.suspensions.find((s) => s.resumedAt === null) ?? null;
  const advanceBlockedBySuspension = project
    ? getAvailableActions(project).advanceBlockedBySuspension
    : false;

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
          // `title` because the crumb truncates: a long project name has to stay reachable
          // to a reader and to a screen reader, and the full name is still in the <h1> below.
          <Link
            href={`/projects/${id}`}
            title={project.name}
            className="max-w-72 truncate hover:text-foreground"
          >
            {project.name}
          </Link>
        ) : (
          <span className="max-w-72 truncate">{t('workspace.loadingProject')}</span>
        )}
        <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
        <span className="font-medium text-foreground">{activeCrumb}</span>
      </nav>

      <section className="mb-6 overflow-hidden border-y border-border bg-surface">
        <div className="px-1 py-3 sm:px-4 sm:py-4">
          {projectQuery.isPending ? (
            <div className="space-y-3" role="status" aria-label={t('workspace.loadingProject')}>
              <div className="h-7 w-64 animate-pulse rounded bg-muted" />
              <div className="h-4 w-48 animate-pulse rounded bg-muted" />
            </div>
          ) : project ? (
            <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2.5">
                  <h1 className="text-h1 font-semibold leading-tight text-foreground">
                    {project.name}
                  </h1>
                  <ProjectStatusBadge status={project.status} />
                </div>
                {/* Identity only: code, client, site. `·`-separated, empties dropped. What the
                    project *is* — not how it is configured, and not what state it is in. */}
                <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-body-sm text-muted-foreground">
                  <span className="shrink-0">{project.code}</span>
                  {/* `min-w-0` is what makes `truncate` work on a flex child: without it the
                      item's automatic minimum size is its content, so a long client name pushes
                      the row wide instead of ellipsizing. `title` keeps the full value
                      reachable. */}
                  {project.clientName ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 max-w-full truncate" title={project.clientName}>
                        {project.clientName}
                      </span>
                    </>
                  ) : null}
                  {siteLabel ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="min-w-0 max-w-full truncate" title={siteLabel}>
                        {siteLabel}
                      </span>
                    </>
                  ) : null}
                </div>
              </div>

              {/* One primary control and an overflow for everything else. These used to be
                  portalled up from the Overview page, which left the other seven tabs with a
                  header that had no actions in it at all. */}
              <ProjectActionsPanel
                project={project}
                setup={summaryQuery.isPending ? undefined : (summaryQuery.data?.setup ?? null)}
              />
            </div>
          ) : null}
        </div>

        {/* Eight peers, no nesting. Every tab leads to a workspace that exists. The bar itself
            is shared with the Administration workspace — see `WorkspaceTabs`. */}
        <WorkspaceTabs
          navLabel={t('workspace.navLabel')}
          selectId="project-workspace-menu"
          className="border-t border-border"
          // The picker sits inside the section's padding; the desktop row deliberately does
          // not, so that the first tab aligns with the content below it.
          selectClassName="mx-4 w-[calc(100%-2rem)]"
          tabs={primaryTabs.map((tab) => ({
            href: tab.href,
            label: tab.label,
            icon: <tab.icon size={16} strokeWidth={1.8} aria-hidden="true" />,
            active: isActive(tab.href),
          }))}
        />
      </section>

      {suspension ? (
        <div className="mb-4">
          <Alert variant="warning" title={tDetail('suspendedTitle')}>
            <p className="mt-1">{suspension.reason}</p>
            <p className="mt-2 text-xs">
              {tDetail('suspendedSince', {
                date: formatDate(suspension.suspendedAt, locale) ?? '—',
              })}
              {advanceBlockedBySuspension ? ` ${tDetail('suspendedBlocks')}` : ''}
            </p>
          </Alert>
        </div>
      ) : null}

      {summaryQuery.isError ? (
        <div className="mb-4">
          <Alert variant="warning" messages={[t('workspace.contractSummaryUnavailable')]} />
        </div>
      ) : null}
      {children}
    </div>
  );
}
