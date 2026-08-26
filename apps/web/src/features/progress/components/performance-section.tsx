'use client';

import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, SectionHeader, Skeleton, type AlertProps, type BadgeProps } from '@erp/ui';
import type { PhysicalFinancialSignalResponse, ProgressScheduleStatus } from '@erp/types';

import { MetricStrip } from '@/components/widget/metric-strip';

import {
  usePhysicalFinancialSignal,
  useProgressCurve,
  useProjectRollup,
} from '../hooks/use-progress';
import { CaptureSnapshotAction } from './capture-snapshot-action';
import { ProgressCurveChart } from './progress-curve-chart';

type SignalStatus = PhysicalFinancialSignalResponse['status'];

const STATUS_VARIANT: Record<SignalStatus, AlertProps['variant']> = {
  ALIGNED: 'success',
  COST_AHEAD: 'warning',
  PROGRESS_AHEAD: 'info',
  INSUFFICIENT_DATA: 'info',
};

const STATUS_HINT: Record<SignalStatus, string> = {
  ALIGNED: 'signal.alignedHint',
  COST_AHEAD: 'signal.costAheadHint',
  PROGRESS_AHEAD: 'signal.progressAheadHint',
  INSUFFICIENT_DATA: 'signal.insufficientHint',
};

/**
 * The schedule-status chip may carry a status colour — it *is* a status (ahead/on-track/behind),
 * not data-viz. This is the one place the Performance view colours by meaning; the curve itself
 * stays on the `--chart-*` ramp.
 */
const SCHEDULE_TONE: Record<ProgressScheduleStatus, BadgeProps['tone']> = {
  AHEAD: 'live',
  ON_TRACK: 'info',
  BEHIND: 'warning',
  INSUFFICIENT_DATA: 'neutral',
};

/** Physical-vs-financial early warning + the planned-vs-actual S-curve and schedule status. */
export function PerformanceSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const signalQuery = usePhysicalFinancialSignal(projectId);
  const rollupQuery = useProjectRollup(projectId);
  const curveQuery = useProgressCurve(projectId);

  if (signalQuery.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <div className="grid gap-3 sm:grid-cols-3">
          <Skeleton className="h-28 w-full" aria-hidden="true" />
          <Skeleton className="h-28 w-full" aria-hidden="true" />
          <Skeleton className="h-28 w-full" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (signalQuery.isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void signalQuery.refetch()}
            disabled={signalQuery.isFetching}
          >
            {t('actions.retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  const s = signalQuery.data;
  const pct = (v: number | null) => (v === null ? null : `${v}%`);
  const divergence = s.divergence === null ? null : `${s.divergence > 0 ? '+' : ''}${s.divergence}%`;

  return (
    <div className="space-y-5">
      {/* Existing signal strip + physical-vs-financial Alert — kept exactly. */}
      <div className="space-y-4">
        <MetricStrip
          aria-label={t('signal.title')}
          metrics={[
            { label: t('signal.physical'), value: `${s.physicalPercent}%` },
            { label: t('signal.cost'), value: pct(s.costConsumedPercent) },
            { label: t('signal.divergence'), value: divergence },
          ]}
        />

        <Alert
          variant={STATUS_VARIANT[s.status]}
          title={t(`signal.status.${s.status}`)}
          messages={[t(STATUS_HINT[s.status])]}
        />

        {rollupQuery.data && !rollupQuery.data.weightsComplete ? (
          <Alert
            variant="warning"
            messages={[t('rollup.weightsIncomplete', { total: rollupQuery.data.weightsTotal })]}
          />
        ) : null}
      </div>

      {/* Progress curve (planned vs actual) + schedule status. */}
      <ProgressCurvePanel projectId={projectId} query={curveQuery} />
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

  // Honest insufficient-data state: no baseline or no snapshots → say so, offer the capture,
  // and never draw a fabricated line.
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

  return (
    <div className="space-y-3">
      <SectionHeader title={t('curve.title')}>
        <div className="flex items-center gap-3">
          <Badge tone={SCHEDULE_TONE[status]}>
            {varianceLabel === null
              ? t(`curve.status.${status}`)
              : `${t(`curve.status.${status}`)} · ${varianceLabel}`}
          </Badge>
          <CaptureSnapshotAction projectId={projectId} />
        </div>
      </SectionHeader>

      <ProgressCurveChart baseline={curve.baseline} actual={curve.actual} showVerified />

      {curve.baselineProvisional ? (
        <p className="text-caption text-muted-foreground">{t('curve.provisionalNote')}</p>
      ) : null}
    </div>
  );
}
