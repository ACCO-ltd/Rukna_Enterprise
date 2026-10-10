'use client';

import Link from 'next/link';
import { ArrowUpRight, FolderX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button, EmptyState, Skeleton, StatusPill } from '@erp/ui';

import { WorkspaceSubNav } from '@/components/layout/workspace-sub-nav';
import { statusTone } from '@/lib/status-registry';

import { ApiError } from '@/lib/api-client';

import {
  useCanViewFinanceProjects,
  useCanViewProjectPayables,
  useFinanceProject,
  useProjectPaymentsAccess,
} from '../hooks';
import { FinanceProjectPicker } from './finance-project-picker';
import { NoFinanceAccess } from './no-finance-access';

const VIEWS = [
  { key: 'overview', segment: '' },
  { key: 'billing', segment: 'billing' },
  { key: 'cost', segment: 'cost' },
  { key: 'pl', segment: 'pl' },
  { key: 'payables', segment: 'payables' },
  { key: 'payments', segment: 'payments' },
  { key: 'cashflow', segment: 'cashflow' },
] as const;

/**
 * A project inside Finance (ADR-043): a filtered view of the same records, not a second
 * accounting system. The header is a project picker — switching project keeps the view — with the
 * project's status and client; the money lives on the Overview dashboard. The tabs render the SAME
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
  // Payables and Payments (ADR-043 Phase 2) show only to holders of their lists' own gates.
  const canPayables = useCanViewProjectPayables();
  const paymentsAccess = useProjectPaymentsAccess();

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

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="finance-project-title"
        className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-panel border border-border bg-surface px-4 py-3 shadow-e1"
      >
        <h2 id="finance-project-title" className="sr-only">
          {t('title', { name: row.name, code: row.code })}
        </h2>
        <FinanceProjectPicker project={row} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-body-sm text-muted-foreground">
          <StatusPill tone={statusTone(row.status, 'project')}>{tStatus(row.status)}</StatusPill>
          <span className="min-w-0 truncate">
            {t('client')} <span className="font-medium text-foreground">{row.clientName ?? '—'}</span>
          </span>
          {row.currency ? <span>{row.currency}</span> : null}
        </div>
        <Button asChild variant="outline" size="sm" className="ms-auto">
          <Link href={`/projects/${projectId}`}>
            {t('openProject')}
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </Button>
      </section>

      <WorkspaceSubNav
        label={t('navLabel')}
        items={VIEWS.filter(
          (view) =>
            (view.key !== 'payables' || canPayables) && (view.key !== 'payments' || paymentsAccess.any),
        ).map((view) => ({
          value: view.key,
          label: t(`views.${view.key}`),
          href: view.segment ? `${base}/${view.segment}` : base,
        }))}
      />

      {children}
    </div>
  );
}
