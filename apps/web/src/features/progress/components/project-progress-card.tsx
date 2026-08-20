'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Activity } from 'lucide-react';
import { Badge, type BadgeTone } from '@erp/ui';
import type { PhysicalFinancialSignalResponse } from '@erp/types';

import { usePhysicalFinancialSignal, useProjectRollup } from '../hooks/use-progress';

type SignalStatus = PhysicalFinancialSignalResponse['status'];

const STATUS_TONE: Record<SignalStatus, BadgeTone> = {
  ALIGNED: 'live',
  COST_AHEAD: 'warning',
  PROGRESS_AHEAD: 'info',
  INSUFFICIENT_DATA: 'neutral',
};

const STATUS_HINT: Record<SignalStatus, string> = {
  ALIGNED: 'signal.alignedHint',
  COST_AHEAD: 'signal.costAheadHint',
  PROGRESS_AHEAD: 'signal.progressAheadHint',
  INSUFFICIENT_DATA: 'signal.insufficientHint',
};

/**
 * Overview cockpit card: weighted physical % and the physical-vs-financial signal, with a link
 * into the Progress workspace. Reads the same ADR-021 signal the Performance tab shows, so the
 * headline on Overview and the detail behind it can never disagree.
 */
export function ProjectProgressCard({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const signal = usePhysicalFinancialSignal(projectId);
  const rollup = useProjectRollup(projectId);

  return (
    <div className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex min-h-12 items-center justify-between border-b border-border px-5">
        <div className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
          <Activity size={16} className="text-muted-foreground" strokeWidth={1.8} aria-hidden="true" />
          {t('overview.title')}
        </div>
        <Link
          href={`/projects/${projectId}/progress`}
          className="text-caption font-medium text-brand-primary hover:underline"
        >
          {t('overview.link')}
        </Link>
      </div>

      <div className="px-5 py-4">
        {signal.isPending ? (
          <div className="h-16 animate-pulse rounded-control bg-muted" aria-hidden="true" />
        ) : signal.isError ? (
          <p className="text-caption text-muted-foreground">{t('states.loadFailed')}</p>
        ) : (
          <>
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="text-caption text-muted-foreground">{t('signal.physical')}</p>
                <p className="text-h2 font-bold tabular-nums text-foreground">
                  {signal.data.physicalPercent}%
                </p>
              </div>
              <Badge tone={STATUS_TONE[signal.data.status]}>
                {t(`signal.status.${signal.data.status}`)}
              </Badge>
            </div>
            <p className="mt-2 text-caption text-muted-foreground">
              {t(STATUS_HINT[signal.data.status])}
            </p>
            {rollup.data && !rollup.data.weightsComplete ? (
              <p className="mt-2 text-micro font-medium text-warning">
                {t('rollup.weightsIncomplete', { total: rollup.data.weightsTotal })}
              </p>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
