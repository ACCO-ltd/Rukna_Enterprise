'use client';

import Link from 'next/link';
import { ArrowUpRight, FolderX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, ContextBar, EmptyState, MoneyDisplay, Skeleton, StatusPill } from '@erp/ui';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';
import { statusTone } from '@/lib/status-registry';

import { ApiError } from '@/lib/api-client';

import { useCanViewFinanceProjects, useFinanceProject } from '../hooks';
import { NoFinanceAccess } from './no-finance-access';

const VIEWS = [
  { key: 'overview', segment: '' },
  { key: 'billing', segment: 'billing' },
  { key: 'cost', segment: 'cost' },
  { key: 'pl', segment: 'pl' },
] as const;

/**
 * A project inside Finance (ADR-043): a filtered view of the same records, not a second
 * accounting system. The header names the project and its contract; the tabs render the SAME
 * components the project workspace uses (finance overview, billing, cost control, P&L + ledger)
 * with their links pointed at Finance pages. "Open project" goes to the construction workspace.
 *
 * The header reads `GET /finance/projects/:id` — the same row as the list, for this project only.
 * A project the caller may not see (project access, other organisation) reads as not found.
 */
export function FinanceProjectWorkspace({ projectId, children }: { projectId: string; children: React.ReactNode }) {
  const t = useTranslations('finance.projects.workspace');
  const tStatus = useTranslations('platform.projects.status');
  const allowed = useCanViewFinanceProjects();
  const project = useFinanceProject(projectId, { enabled: allowed });

  if (!allowed) return <NoFinanceAccess />;
  if (project.isPending) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <span className="sr-only">{t('loading')}</span>
        <Skeleton className="h-20 w-full rounded-panel" aria-hidden="true" />
        <Skeleton className="h-10 w-80" aria-hidden="true" />
      </div>
    );
  }

  const row = project.data?.item;
  // 404 (not in this organisation) and 403 (not a member) both read as "not found".
  const notFound = project.error instanceof ApiError && (project.error.status === 404 || project.error.status === 403);
  if (!row) {
    const failed = project.isError && !notFound;
    return (
      <EmptyState
        variant="page"
        icon={<FolderX size={24} aria-hidden="true" />}
        title={failed ? t('loadFailed') : t('notFound')}
        description={failed ? undefined : t('notFoundHint')}
        action={
          <Button asChild variant="outline">
            <Link href="/finance/projects">{t('back')}</Link>
          </Button>
        }
      />
    );
  }

  const base = `/finance/projects/${projectId}`;
  const hidden = !project.data!.moneyVisible;

  return (
    <div className="space-y-4">
      <ContextBar
        headingId="finance-project-title"
        headingLevel="h2"
        title={t('title', { name: row.name, code: row.code })}
        status={<StatusPill tone={statusTone(row.status, 'project')}>{tStatus(row.status)}</StatusPill>}
        metrics={[
          { key: 'client', label: t('client'), value: row.clientName ?? '—' },
          {
            key: 'contract',
            label: t('contractValue'),
            value: <MoneyDisplay value={row.contractValue} hidden={hidden} hiddenLabel={t('hidden')} unavailableLabel={t('noContract')} />,
          },
          { key: 'currency', label: t('currency'), value: row.currency ?? '—' },
        ]}
        primary={
          <Button asChild variant="outline" size="sm">
            <Link href={`/projects/${projectId}`}>
              {t('openProject')}
              <ArrowUpRight size={15} aria-hidden="true" />
            </Link>
          </Button>
        }
      />

      <WorkspaceSubNav
        label={t('navLabel')}
        items={VIEWS.map((view) => ({
          value: view.key,
          label: t(`views.${view.key}`),
          href: view.segment ? `${base}/${view.segment}` : base,
        }))}
      />

      {children}
    </div>
  );
}
