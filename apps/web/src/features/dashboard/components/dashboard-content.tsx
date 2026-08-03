'use client';

import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Button } from '@erp/ui';

import { ProjectStatusBadge } from '@/features/projects/components/project-status-badge';
import { useProjects } from '@/features/projects/hooks/use-projects';
import { formatNumber } from '@/lib/format';

import { summarizeProjects, type StatusCount } from '../summarize-projects';
import { RecentProjects } from './recent-projects';

export function DashboardContent() {
  const t = useTranslations('platform.dashboard');
  const { data, isPending, isError, refetch, isFetching } = useProjects();

  if (isPending) return <DashboardSkeleton />;

  if (isError) {
    return (
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

  return (
    <div className="space-y-8">
      <section aria-labelledby="portfolio-heading">
        <h2
          id="portfolio-heading"
          className="text-sm font-semibold uppercase tracking-wide text-muted-foreground"
        >
          {t('portfolioHeading')}
        </h2>

        <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <TotalTile total={summary.total} />
          {summary.statusCounts.map((entry) => (
            <StatusTile key={entry.status} entry={entry} />
          ))}
        </dl>
      </section>

      <RecentProjects projects={summary.recent} />

      <div>
        {/* inline-flex + min-h-11 keeps a plain text link at the 44px touch-target floor. */}
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

function TotalTile({ total }: { total: number }) {
  const t = useTranslations('platform.dashboard');
  const locale = useLocale() as 'en' | 'ar';

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt className="text-xs font-medium text-muted-foreground">{t('totalProjects')}</dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {formatNumber(total, locale)}
      </dd>
    </div>
  );
}

function StatusTile({ entry }: { entry: StatusCount }) {
  const locale = useLocale() as 'en' | 'ar';

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <dt>
        <ProjectStatusBadge status={entry.status} />
      </dt>
      <dd className="mt-2 text-2xl font-semibold tabular-nums text-foreground">
        {formatNumber(entry.count, locale)}
      </dd>
    </div>
  );
}

function DashboardSkeleton() {
  const t = useTranslations('common');

  // The placeholder blocks are decorative, but the loading state itself must still be
  // announced — otherwise a screen reader reaches a silent, apparently empty page.
  return (
    <div role="status" aria-live="polite" className="space-y-8">
      <span className="sr-only">{t('loading')}</span>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-muted" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
    </div>
  );
}
