'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import { Alert, Button, RecordHeader } from '@erp/ui';
import { Building2, ChevronRight, MapPin } from 'lucide-react';

import { usePermissions, type PermissionKey } from '@/features/auth/permissions/can';
import { ProjectActionsPanel } from '@/features/projects/components/project-actions-panel';
import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useDistricts } from '@/features/districts/hooks/use-districts';
import { useProject } from '@/features/projects/hooks/use-project';
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
 *  - **The lifecycle strip.** Project stage is said once, by the status pill beside the name
 *    (from the status registry). A second stepper — here, or later on Overview — was a second
 *    lifecycle indicator that could disagree with the first, so both are gone.
 *  - **The four-tile summary row.** Main contract, programme, physical progress and current
 *    stage: every one of them is now stated once, in the Overview section that owns it.
 *  - **Tab icons.** Eight labels already name eight places; a glyph per tab was decoration the
 *    reader had to parse before the word.
 *
 * The commercial model left the metadata line for the same reason — it is configuration, not
 * identity, and it reads on Overview under Commercial.
 */
export function ProjectWorkspaceShell({ id, children }: ProjectWorkspaceShellProps) {
  const t = useTranslations('platform.projects');
  const tDetail = useTranslations('platform.projects.detail');
  const pathname = usePathname();
  const locale = useLocale() as 'en' | 'ar';
  const projectQuery = useProject(id);
  const project = projectQuery.data;
  const { can } = usePermissions();

  // The project carries `districtId`, not the district's name, so the site line is composed
  // here from the registry the picker has already fetched and cached. All districts rather than
  // only active ones: a project built in a district since retired still has to read.
  const { data: districts = [] } = useDistricts(false);
  const districtName = districts.find((d) => d.id === project?.districtId)?.name ?? null;
  // "Hodan, Hotel Sahafi" — the administrative area, then the address inside it, which is the
  // order a site gets given to a driver. Either half stands alone when the other is absent.
  const siteLabel = [districtName, project?.location].filter(Boolean).join(', ');

  // Ordered by the project's operating logic rather than by the order the workspaces shipped:
  // understand → scope → execute → earn → spend → evidence → people. Documents before Team
  // because project evidence is read daily and membership is changed rarely.
  const allTabs: Array<{
    key: string;
    label: string;
    href: string;
    // A money tab the user must hold the matching read permission to see. Gating these keeps
    // money-blind roles (Project Manager / Site Engineer) off dead tabs that would 403 when
    // clicked — the server stays the boundary; this only removes the dead-end.
    requires?: PermissionKey;
  }> = [
    {
      key: 'overview',
      label: t('workspace.overview'),
      href: `/projects/${id}`,
    },
    // Named "BOQ", not "Scope" or "Planning". For construction professionals BOQ is the precise
    // term, and the aggregate behind this tab really is a versioned, baselined bill of
    // quantities. "Planning" would be the right name only once programme, work packages and
    // milestones lived under it too. See ADR-016.
    { key: 'boq', label: t('workspace.boq'), href: `/projects/${id}/boq` },
    {
      key: 'progress',
      label: t('workspace.progress'),
      href: `/projects/${id}/progress`,
    },
    // One tab, not a dropdown. Commercial was three flat entries — Contracts, Applications &
    // certificates, Finance — inside the only nested control in this bar, and they duplicated
    // the Commercial workspace's own sub-nav. The contract and certificate routes now live
    // under /commercial/*; billing and accounting truth live in Finance (ADR-043).
    {
      key: 'commercial',
      label: t('workspace.commercial'),
      href: `/projects/${id}/commercial`,
      requires: 'view:contract',
    },
    {
      key: 'procurement',
      label: t('workspace.procurement'),
      href: `/projects/${id}/procurement`,
      requires: 'view:procurement',
    },
    // No Finance tab (ADR-043 Phase 3): a project's money — billing, cost, P&L, ledger — is read
    // and acted on in Finance → Projects. The old /projects/:id/finance/** URLs redirect there.
    {
      key: 'documents',
      label: t('workspace.documents'),
      href: `/projects/${id}/documents`,
    },
    { key: 'team', label: t('workspace.team'), href: `/projects/${id}/members` },
  ];

  // Drop the money tabs the current user cannot open, so a money-blind role never lands on a
  // 403 dead-end. Overview / BOQ / Progress / Documents / Team are always available.
  const primaryTabs = allTabs.filter((tab) => !tab.requires || can(tab.requires));

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
            <RecordHeader
              surface="plain"
              statusPlacement="title"
              title={project.name}
              status={<ProjectStatusBadge status={project.status} />}
              // Identity only: code, client, site. What the project *is* — not how it is
              // configured, and not what state it is in. Each item names itself to a screen
              // reader, because a bare "ACC-HDN-26-0005" or "Hodan" says nothing out of context.
              meta={
                <>
                  <span className="shrink-0 tabular-nums">
                    <span className="sr-only">{t('workspace.metaCode')}: </span>
                    {project.code}
                  </span>
                  {project.clientName ? (
                    // `min-w-0` is what makes `truncate` work on a flex child; `title` keeps the
                    // full value reachable.
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <Building2 size={14} className="shrink-0" aria-hidden="true" />
                      <span className="sr-only">{t('workspace.metaClient')}: </span>
                      {project.clientId && can('view:client') ? (
                        <Link
                          href={`/clients/${project.clientId}`}
                          title={project.clientName}
                          className="truncate hover:text-foreground hover:underline"
                        >
                          {project.clientName}
                        </Link>
                      ) : (
                        <span className="truncate" title={project.clientName}>
                          {project.clientName}
                        </span>
                      )}
                    </span>
                  ) : null}
                  {siteLabel ? (
                    <span className="inline-flex min-w-0 max-w-full items-center gap-1.5">
                      <MapPin size={14} className="shrink-0" aria-hidden="true" />
                      <span className="sr-only">{t('workspace.metaSite')}: </span>
                      <span className="truncate" title={siteLabel}>
                        {siteLabel}
                      </span>
                    </span>
                  ) : null}
                </>
              }
              // One primary per screen. On Overview the header owns it (Start project, Record
              // practical completion…); on every other tab the tab's own bar owns the next step
              // (the BOQ bar's Create contract, say), so the header keeps only its overflow.
              actions={
                <ProjectActionsPanel
                  project={project}
                  // Overview itself, not its edit form: the form's Save is that screen's primary.
                  showPrimary={pathname === `/projects/${id}`}
                />
              }
            />
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


      {children}
    </div>
  );
}
