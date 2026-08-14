'use client';

import Link from 'next/link';
import { FileText } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { EmptyState } from '@/components/empty-state';
import { formatDate } from '@/lib/format';
import type { CommercialSummaryResponse } from '@erp/types';

import { CommercialMetricTile } from './commercial-metric-tile';
import { AttentionList, FactRow, SectionCard } from './commercial-ui';

/** C1 — Commercial Overview: summary strip, attention, then the operational panels. */
export function OverviewTab({
  projectId,
  summary,
}: {
  projectId: string;
  summary: CommercialSummaryResponse;
}) {
  const t = useTranslations('commercial');
  const locale = useLocale() as 'en' | 'ar';
  const base = `/projects/${projectId}/commercial`;

  if (!summary.mainContract) {
    return (
      <EmptyState
        variant="page"
        icon={<FileText size={25} strokeWidth={1.8} aria-hidden="true" />}
        title={t('overview.noContractTitle')}
        description={t('overview.noContractHint')}
        action={
          summary.attention.find((a) => a.kind === 'NO_MAIN_CONTRACT')?.actionUrl ? (
            <Link
              href={summary.attention.find((a) => a.kind === 'NO_MAIN_CONTRACT')!.actionUrl!}
              className="inline-flex min-h-[44px] items-center text-body-sm font-medium text-brand-primary hover:underline sm:min-h-0"
            >
              {t('attention.NO_MAIN_CONTRACT.action')}
            </Link>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {/* Summary strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <CommercialMetricTile label={t('metric.contractValue')} metric={summary.metrics.contractValue} />
        <CommercialMetricTile label={t('metric.certified')} metric={summary.metrics.certifiedNet} />
        <CommercialMetricTile label={t('metric.invoiced')} metric={summary.metrics.invoiced} />
        <CommercialMetricTile label={t('metric.received')} metric={summary.metrics.received} />
        <CommercialMetricTile label={t('metric.outstanding')} metric={summary.metrics.outstanding} />
      </div>

      {/* Attention */}
      <SectionCard title={t('overview.attention')}>
        <AttentionList items={summary.attention} />
      </SectionCard>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* Retention & advances snapshot */}
        <SectionCard
          title={t('tabs.retention-advances')}
          action={
            <Link
              href={`${base}/retention-advances`}
              className="inline-flex min-h-[44px] items-center text-caption text-brand-primary hover:underline sm:min-h-0"
            >
              {t('actions.view')}
            </Link>
          }
        >
          {summary.retention ? (
            <>
              <FactRow label={t('retention.rate')}>
                {percent(summary.retention.retentionRate)}
              </FactRow>
              <FactRow label={t('retention.cap')}>{percent(summary.retention.retentionCap)}</FactRow>
            </>
          ) : (
            <p className="text-body-sm text-muted-foreground">{t('retention.none')}</p>
          )}
          <FactRow label={t('advances.count')}>{summary.advances.length}</FactRow>
        </SectionCard>

        {/* Guarantees snapshot */}
        <SectionCard
          title={t('tabs.guarantees')}
          action={
            <Link
              href={`${base}/guarantees`}
              className="inline-flex min-h-[44px] items-center text-caption text-brand-primary hover:underline sm:min-h-0"
            >
              {t('actions.view')}
            </Link>
          }
        >
          {summary.guarantees.length === 0 ? (
            <p className="text-body-sm text-muted-foreground">{t('guarantees.none')}</p>
          ) : (
            <>
              <FactRow label={t('guarantees.total')}>{summary.guarantees.length}</FactRow>
              <FactRow label={t('guarantees.attentionNeeded')}>
                {summary.guarantees.filter((g) => g.attention !== 'NONE').length}
              </FactRow>
            </>
          )}
        </SectionCard>
      </div>

      {/* Recent commercial activity */}
      <SectionCard title={t('overview.recentActivity')}>
        {summary.recentActivity.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('overview.noActivity')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {summary.recentActivity.map((event) => (
              <li key={event.id} className="flex items-center justify-between gap-3 py-2 text-body-sm">
                <span className="min-w-0 truncate text-foreground">
                  {event.sourceCommand ?? event.action}
                </span>
                <span className="shrink-0 text-caption text-muted-foreground">
                  {event.actor.name} · {formatDate(event.occurredAt, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );

  function percent(rate: string): string {
    const n = Number(rate);
    if (!Number.isFinite(n)) return rate;
    return `${(n * 100).toFixed(2)}%`;
  }
}
