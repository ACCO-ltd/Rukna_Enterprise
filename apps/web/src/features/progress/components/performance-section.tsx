'use client';

import { useTranslations } from 'next-intl';
import { Alert, Button, Skeleton, type AlertProps } from '@erp/ui';
import type { PhysicalFinancialSignalResponse } from '@erp/types';

import { MetricStrip } from '@/components/widget/metric-strip';

import { usePhysicalFinancialSignal, useProjectRollup } from '../hooks/use-progress';

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

/** Physical-vs-financial early warning + roll-up weight completeness. */
export function PerformanceSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const signalQuery = usePhysicalFinancialSignal(projectId);
  const rollupQuery = useProjectRollup(projectId);

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
    <div className="space-y-4">
      <MetricStrip
        aria-label={t('signal.title')}
        metrics={[
          { label: t('signal.physical'), value: `${s.physicalPercent}%` },
          { label: t('signal.cost'), value: pct(s.costConsumedPercent) },
          { label: t('signal.divergence'), value: divergence },
        ]}
      />

      <Alert variant={STATUS_VARIANT[s.status]} title={t(`signal.status.${s.status}`)} messages={[t(STATUS_HINT[s.status])]} />

      {rollupQuery.data && !rollupQuery.data.weightsComplete ? (
        <Alert
          variant="warning"
          messages={[t('rollup.weightsIncomplete', { total: rollupQuery.data.weightsTotal })]}
        />
      ) : null}
    </div>
  );
}
