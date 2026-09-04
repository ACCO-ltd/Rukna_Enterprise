'use client';

import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, SectionHeader, Skeleton, type BadgeProps } from '@erp/ui';
import type { ProgressScheduleStatus } from '@erp/types';

import { MetricStrip } from '@/components/widget/metric-strip';
import { formatDate } from '@/lib/format';

import { useProgressCurve } from '../hooks/use-progress';
import { CaptureSnapshotAction } from './capture-snapshot-action';
import { CollectionProgressSignalBanner } from './collection-progress-signal-banner';
import { PhysicalFinancialSignalBanner } from './physical-financial-signal-banner';
import { ProgressCurveChart } from './progress-curve-chart';

/**
 * The schedule-status chip *is* a status (ahead/on-track/behind), so it colours by meaning. This is
 * the one place the Performance view colours by status; the curve itself stays on the `--chart-*`
 * ramp. Mirrors the headline band so the tab reads one vocabulary.
 */
const SCHEDULE_TONE: Record<ProgressScheduleStatus, BadgeProps['tone']> = {
  AHEAD: 'live',
  ON_TRACK: 'info',
  BEHIND: 'warning',
  INSUFFICIENT_DATA: 'neutral',
};

/**
 * Performance view: the planned-vs-actual S-curve with schedule status, then both cockpit signals
 * (physical-vs-financial + collection-vs-progress) with their explanatory hints.
 *
 * The physical/cost/alignment figures now headline the tab's always-on band, so this view no longer
 * repeats them — it leads with the curve (the detail behind the headline) and gathers both signals
 * in one place instead of scattering them across Progress and Finance.
 */
export function PerformanceSection({ projectId }: { projectId: string }) {
  const curveQuery = useProgressCurve(projectId);

  return (
    <div className="space-y-5">
      <ProgressCurvePanel projectId={projectId} query={curveQuery} />

      <div className="space-y-4">
        {/* The physical-vs-financial link would point back to this same tab, so it's suppressed
            here; the collection banner keeps its cross-link into Commercial. */}
        <PhysicalFinancialSignalBanner projectId={projectId} showLink={false} />
        <CollectionProgressSignalBanner projectId={projectId} />
      </div>
    </div>
  );
}

function ProgressCurvePanel({
  projectId,
  query,
}: {
  projectId: string;
  query: ReturnType<typeof useProgressCurve>;
}) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');

  const header = (
    <SectionHeader title={t('curve.title')}>
      <CaptureSnapshotAction projectId={projectId} />
    </SectionHeader>
  );

  if (query.isPending) {
    return (
      <div className="space-y-3">
        {header}
        <div role="status" aria-live="polite">
          <span className="sr-only">{tCommon('loading')}</span>
          <Skeleton className="h-56 w-full" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="space-y-3">
        {header}
        <Alert variant="error" messages={[t('states.loadFailed')]}>
          <div className="mt-3">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              {t('actions.retry')}
            </Button>
          </div>
        </Alert>
      </div>
    );
  }

  const curve = query.data;
  const status = curve.status;

  // Honest insufficient-data state: no baseline or no snapshots → say so, offer the capture, and
  // never draw a fabricated line.
  if (status === 'INSUFFICIENT_DATA' || curve.actual.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <div className="rounded-panel border border-dashed border-border bg-surface px-6 py-12 text-center">
          <p className="text-sm text-muted-foreground">{t('curve.insufficient')}</p>
          <div className="mt-4 flex justify-center">
            <CaptureSnapshotAction projectId={projectId} variant="outline" allowDateChoice />
          </div>
        </div>
      </div>
    );
  }

  const variance = curve.scheduleVariancePercent;
  // Real minus sign for negatives (ux-doctrine §3), + for a positive lead over plan.
  const varianceLabel =
    variance === null
      ? null
      : `${variance > 0 ? '+' : variance < 0 ? '−' : ''}${Math.abs(variance)}%`;

  // Baseline is sampled at the snapshot dates, so the last point is "planned to date".
  const plannedToDate = curve.baseline.at(-1)?.plannedPercent ?? null;
  const latest = curve.actual.at(-1) ?? null;
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);

  return (
    <div className="space-y-3">
      <SectionHeader title={t('curve.title')}>
        <div className="flex items-center gap-3">
          {curve.baselineProvisional ? (
            <Badge tone="accent">{t('curve.provisionalChip')}</Badge>
          ) : null}
          <Badge tone={SCHEDULE_TONE[status]}>
            {varianceLabel === null
              ? t(`curve.status.${status}`)
              : `${t(`curve.status.${status}`)} · ${varianceLabel}`}
          </Badge>
          <CaptureSnapshotAction projectId={projectId} />
        </div>
      </SectionHeader>

      <MetricStrip
        aria-label={t('curve.scheduleStripLabel')}
        metrics={[
          { label: t('curve.plannedToDate'), value: pct(plannedToDate) },
          { label: t('curve.actual'), value: latest ? `${latest.physicalPercent}%` : '—' },
          { label: t('curve.verified'), value: latest ? `${latest.verifiedPercent}%` : '—' },
        ]}
      />

      <ProgressCurveChart
        baseline={curve.baseline}
        actual={curve.actual}
        showVerified
        plannedProvisional={curve.baselineProvisional}
      />

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        {latest ? (
          <p className="text-caption text-muted-foreground">
            {t('curve.lastSnapshot', { date: formatDate(latest.periodEndDate) ?? '—' })}
          </p>
        ) : null}
        {curve.baselineProvisional ? (
          <p className="text-caption text-muted-foreground">{t('curve.provisionalNote')}</p>
        ) : null}
      </div>
    </div>
  );
}
