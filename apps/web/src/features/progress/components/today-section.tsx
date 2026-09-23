'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { type DprStatus } from '@erp/types';
import { Badge, Button, Skeleton } from '@erp/ui';

import { formatDate } from '@/lib/format';

import { useDprs, useProjectRollup } from '../hooks/use-progress';
import { ProgressHeadline } from './progress-headline';
import { DailyReportsSection } from './daily-reports-section';
import { DprDetail } from './dpr-detail';
import { DprStatusBadge } from './dpr-status-badge';

/**
 * Today view — the SE's primary entry point.
 *
 * Shows the current-day DPR state with one primary action above the fold,
 * then the recent reports list. The ProgressHeadline band is shown when
 * the project is set up (has work packages + allocation + weights); otherwise
 * it is silently omitted so the SE is never blocked by a PM setup task.
 *
 * Phase 3 will add the structured DPR editor (Section A–E). For now, the
 * DailyReportsSection below provides the full record workflow.
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

      {/* Today's DPR status banner — shows once the DPR list has loaded */}
      <TodayDprBanner
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

function TodayDprBanner({
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
  if (isPending) return <Skeleton className="h-16 w-full" aria-hidden="true" />;
  if (isError) return null;

  const dateLabel = formatDate(today, locale as 'en');

  if (!todayDpr) {
    return (
      <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-body-sm font-medium text-foreground">{dateLabel}</p>
          <p className="text-body-xs text-muted-foreground">{t('today.noReportHint')}</p>
        </div>
      </div>
    );
  }

  const { status } = todayDpr;

  return (
    <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <DprStatusBadge status={status} />
        <p className="text-body-sm text-muted-foreground">{dateLabel}</p>
      </div>
      {(status === 'DRAFT' || status === 'RETURNED') && (
        <Button size="sm" onClick={() => onOpen(todayDpr.id)}>
          {status === 'RETURNED' ? t('today.reviseReport') : t('today.continueReport')}
        </Button>
      )}
      {status === 'SUBMITTED' && (
        <Badge tone="info">{t('today.awaitingReview')}</Badge>
      )}
      {status === 'APPROVED' && (
        <Button size="sm" variant="outline" onClick={() => onOpen(todayDpr.id)}>
          {t('report.status.APPROVED')}
        </Button>
      )}
    </div>
  );
}
