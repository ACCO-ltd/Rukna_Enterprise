'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';
import { ProjectStatus } from '@erp/types';

import { MetricStrip, type Metric } from '@/components/widget/metric-strip';
import { WidgetShell } from '@/components/widget/widget-shell';
import { useClients } from '@/features/clients/hooks/use-clients';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { formatNumber } from '@/lib/format';

import { summarizeProjects } from '../summarize-projects';
import { PortfolioTableWidget } from './portfolio-table-widget';

const ACTIVE_STATUSES: ProjectStatus[] = [
  ProjectStatus.ACTIVE,
  ProjectStatus.PRACTICAL_COMPLETION,
  ProjectStatus.CLOSEOUT,
];

// ADR-019 CONST-PLC-001: APPROVED and MOBILIZING retired into DRAFT ("Preparation") —
// projects still being prepared count as pending, not active.
const PENDING_STATUSES: ProjectStatus[] = [ProjectStatus.DRAFT];

const FINISHED_STATUSES: ProjectStatus[] = [
  ProjectStatus.CLOSED,
  ProjectStatus.CANCELLED,
];

function countStatuses(
  statusCounts: { status: ProjectStatus; count: number }[],
  statuses: ProjectStatus[],
): number {
  return statusCounts
    .filter((s) => statuses.includes(s.status))
    .reduce((acc, s) => acc + s.count, 0);
}

export function DashboardContent() {
  const t = useTranslations('platform.dashboard');
  const locale = useLocale() as 'en' | 'ar';
  const { data, isPending, isError, refetch, isFetching } = useProjects();
  const { data: clients, isPending: clientsLoading, isError: clientsError } = useClients();

  // Client KPI is independent of the projects query — compute it early so it
  // renders even when the projects fetch fails (D-07 failure isolation).
  const clientCount = clients?.length ?? 0;
  const clientValue = (clientsLoading || clientsError) ? '—' : (formatNumber(clientCount, locale) ?? clientCount);

  if (isPending) return <DashboardSkeleton />;

  if (isError) {
    return (
      <div className="space-y-8">
        <Alert variant="error" messages={[t('loadFailed')]}>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void refetch();
              }}
              disabled={isFetching}
            >
              {t('retry')}
            </Button>
          </div>
        </Alert>
        {/* Failure isolation (D4): the client metric is independent of the failed
            projects query, so it still renders — as a reduced one-metric strip. */}
        <WidgetShell id="portfolio-heading" title={t('portfolioHeading')}>
          <MetricStrip
            aria-label={t('portfolioHeading')}
            metrics={[{ label: t('kpiClients'), value: clientValue, href: '/clients' }]}
          />
        </WidgetShell>
      </div>
    );
  }

  const summary = summarizeProjects(data);

  if (summary.total === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center">
        <p className="text-sm font-medium text-foreground">{t('empty')}</p>
        <p className="mt-1 text-sm text-muted-foreground">{t('emptyHint')}</p>
      </div>
    );
  }

  const active = countStatuses(summary.statusCounts, ACTIVE_STATUSES);
  const pending = countStatuses(summary.statusCounts, PENDING_STATUSES);
  const finished = countStatuses(summary.statusCounts, FINISHED_STATUSES);

  // Same five metrics, same hrefs and values as the retired KpiCard grid (D2).
  // "Finished" has no filtered list route today, so it carries no href.
  const metrics: Metric[] = [
    {
      label: t('totalProjects'),
      value: formatNumber(summary.total, locale) ?? summary.total,
      href: '/projects',
    },
    {
      label: t('kpiActive'),
      value: formatNumber(active, locale) ?? active,
      href: '/projects',
    },
    {
      label: t('kpiPending'),
      value: formatNumber(pending, locale) ?? pending,
      href: '/projects',
    },
    {
      label: t('kpiFinished'),
      value: formatNumber(finished, locale) ?? finished,
    },
    {
      label: t('kpiClients'),
      value: clientValue,
      href: '/clients',
    },
  ];

  return (
    <div className="space-y-8">
      {/* §3a interim: metric strip + reused portfolio table. The §3b "requires your
          action" queue slots in below this strip when GET /attention-items ships
          (#105) — no fake queue until then (doctrine §4, §6). */}
      <WidgetShell id="portfolio-heading" title={t('portfolioHeading')}>
        <MetricStrip aria-label={t('portfolioHeading')} metrics={metrics} />
      </WidgetShell>

      <WidgetShell id="recent-heading" title={t('recentHeading')}>
        <PortfolioTableWidget projects={summary.recent} />
      </WidgetShell>

      <div>
        <Link
          href="/projects"
          className="inline-flex min-h-11 items-center text-sm font-semibold text-brand-primary hover:text-brand-primary-hover"
        >
          {t('viewAll')}
        </Link>
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  const t = useTranslations('common');

  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">{t('loading')}</span>

      {/* Strip-shaped: a single hairline-bounded row, not five card blocks. */}
      <div
        className="grid grid-cols-2 border-y border-border sm:grid-cols-3 lg:grid-cols-5"
        aria-hidden="true"
      >
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`space-y-2 px-4 py-3 ${i === 0 ? '' : 'border-s border-border'}`}>
            <div className="h-3 w-16 animate-pulse rounded-control bg-muted" />
            <div className="h-7 w-12 animate-pulse rounded-control bg-muted" />
          </div>
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
    </div>
  );
}
