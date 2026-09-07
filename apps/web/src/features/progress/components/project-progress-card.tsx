'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, RecordPanel, type BadgeTone } from '@erp/ui';
import { Activity } from 'lucide-react';
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
 *
 * On `RecordPanel` like every other Overview region — it used to carry its own hand-rolled
 * surface, one hairline lighter than its neighbours, which read as a mistake once the regions
 * around it became panels.
 */
export function ProjectProgressCard({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const signal = usePhysicalFinancialSignal(projectId);
  const rollup = useProjectRollup(projectId);

  return (
    <RecordPanel
      title={t('overview.title')}
      icon={<Activity size={17} strokeWidth={1.9} />}
      action={
        <Link
          href={`/projects/${projectId}/progress`}
          className="text-caption font-medium text-brand-primary hover:underline"
        >
          {t('overview.link')}
        </Link>
      }
    >
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
    </RecordPanel>
  );
}
