'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type DprStatus } from '@erp/types';
import { Skeleton } from '@erp/ui';
import { ClipboardList, FileText, HardHat, Image as ImageIcon, TriangleAlert } from 'lucide-react';

import { formatDate } from '@/lib/format';

import type { DailyProgressReportDetail } from '../api/progress-api';
import { useDpr, useDprs, useProjectRollup } from '../hooks/use-progress';
import { ProgressHeadline } from './progress-headline';
import { DailyReportsSection } from './daily-reports-section';
import { DprDetail } from './dpr-detail';
import { DprStatusBadge } from './dpr-status-badge';
import { RefButton, RefCard, RefCardBody, RefCardHeader, RefPill } from './ref-ui';

/**
 * Today view — the SE's primary entry point.
 *
 * Shows the current-day DPR state with one primary action above the fold,
 * then the recent reports list. The ProgressHeadline band is shown when
 * the project is set up (has work packages + allocation + weights); otherwise
 * it is silently omitted so the SE is never blocked by a PM setup task.
 */
export function TodaySection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const rollup = useProjectRollup(projectId);
  const dprs = useDprs(projectId);
  const [selectedDprId, setSelectedDprId] = useState<string | null>(null);

  const modelReady = Boolean(
    rollup.data?.weightsComplete && rollup.data.packages.some((p) => p.leafCount > 0),
  );

  const today = new Date().toISOString().slice(0, 10);
  const todayDpr = dprs.data?.find((d) => d.reportDate.slice(0, 10) === today) ?? null;

  if (selectedDprId) {
    return (
      <DprDetail
        projectId={projectId}
        dprId={selectedDprId}
        onBack={() => setSelectedDprId(null)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {modelReady && <ProgressHeadline projectId={projectId} />}

      <TodayReportCard
        today={today}
        todayDpr={todayDpr}
        isPending={dprs.isPending}
        isError={dprs.isError}
        onOpen={(id) => setSelectedDprId(id)}
        locale={locale}
        t={t}
      />

      {/* Full report history / creation — passes down its own internal state */}
      <DailyReportsSection projectId={projectId} />
    </div>
  );
}

function TodayReportCard({
  today,
  todayDpr,
  isPending,
  isError,
  onOpen,
  locale,
  t,
}: {
  today: string;
  todayDpr: { id: string; status: `${DprStatus}`; reportDate: string } | null;
  isPending: boolean;
  isError: boolean;
  onOpen: (id: string) => void;
  locale: string;
  t: ReturnType<typeof useTranslations<'progress'>>;
}) {
  // Only fires once there is a today's report — `useDpr` no-ops on an empty id.
  const detail = useDpr(todayDpr?.id ?? '');

  if (isPending) return <Skeleton className="h-24 w-full rounded-container" aria-hidden="true" />;
  if (isError) return null;

  const dateLabel = formatDate(today, locale as 'en');

  if (!todayDpr) {
    return (
      <RefCard>
        <RefCardHeader icon={<FileText size={17} strokeWidth={1.9} />} title={dateLabel} subtitle={t('today.noReportHint')} />
        <RefCardBody />
      </RefCard>
    );
  }

  const { status } = todayDpr;
  const d = detail.data;

  return (
    <RefCard>
      <RefCardHeader
        icon={<FileText size={17} strokeWidth={1.9} />}
        title={t('today.cardTitle')}
        subtitle={dateLabel}
        action={
          status === 'DRAFT' || status === 'RETURNED' ? (
            <RefButton size="sm" onClick={() => onOpen(todayDpr.id)}>
              {status === 'RETURNED' ? t('today.reviseReport') : t('today.continueReport')}
            </RefButton>
          ) : status === 'SUBMITTED' ? (
            <RefPill tone="blue">{t('today.awaitingReview')}</RefPill>
          ) : (
            <RefButton variant="outline" size="sm" onClick={() => onOpen(todayDpr.id)}>
              {t('today.viewReport')}
            </RefButton>
          )
        }
      />
      <RefCardBody>
        <div className="mt-3 divide-y divide-border border-t border-border">
          <SummaryRow
            icon={<HardHat size={16} strokeWidth={1.9} />}
            tone="green"
            label={t('today.workCompleted')}
            value={
              d
                ? d.measurements.length > 0
                  ? t('today.workCompletedCount', { count: d.measurements.length })
                  : t('today.workCompletedNone')
                : undefined
            }
          />
          <SummaryRow
            icon={<ClipboardList size={16} strokeWidth={1.9} />}
            tone="blue"
            label={t('today.labourOnSite')}
            value={d ? labourSummary(d, t) : undefined}
          />
          <SummaryRow
            icon={<TriangleAlert size={16} strokeWidth={1.9} />}
            tone="amber"
            label={t('today.issues')}
            value={
              d
                ? (d.observations?.length ?? 0) > 0
                  ? t('today.issuesCount', { count: d.observations?.length ?? 0 })
                  : t('today.issuesNone')
                : undefined
            }
          />
          <SummaryRow
            icon={<ImageIcon size={16} strokeWidth={1.9} />}
            tone="violet"
            label={t('today.photos')}
            value={
              d
                ? d.attachments.length > 0
                  ? t('today.photosCount', { count: d.attachments.length })
                  : t('today.photosNone')
                : undefined
            }
          />
        </div>
        <div className="mt-3 flex items-center gap-2">
          <DprStatusBadge status={status} />
        </div>
      </RefCardBody>
    </RefCard>
  );
}

function labourSummary(
  d: DailyProgressReportDetail,
  t: ReturnType<typeof useTranslations<'progress'>>,
): string {
  if (typeof d.labourCount === 'number') return String(d.labourCount);
  if (d.labourRows && d.labourRows.length > 0) {
    const total = d.labourRows.reduce((sum, row) => sum + row.headcount, 0);
    return String(total);
  }
  return t('today.labourNone');
}

function SummaryRow({
  icon,
  tone,
  label,
  value,
}: {
  icon: React.ReactNode;
  tone: 'green' | 'blue' | 'amber' | 'violet';
  label: string;
  value: string | undefined;
}) {
  const toneClass: Record<typeof tone, string> = {
    green: 'bg-success-subtle text-success',
    blue: 'bg-brand-accent text-brand-primary',
    amber: 'bg-warning-subtle text-warning',
    violet: 'bg-historical-subtle text-historical',
  };
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${toneClass[tone]}`} aria-hidden="true">
          {icon}
        </span>
        <span className="truncate text-body text-muted-foreground">{label}</span>
      </div>
      {value === undefined ? (
        <span className="h-3.5 w-20 animate-pulse rounded bg-muted" aria-hidden="true" />
      ) : (
        <span className="shrink-0 text-body font-medium text-foreground">{value}</span>
      )}
    </div>
  );
}
