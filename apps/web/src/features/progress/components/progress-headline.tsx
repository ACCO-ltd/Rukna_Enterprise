'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Badge, StatTile, type BadgeProps } from '@erp/ui';
import type { PhysicalFinancialSignalResponse, ProgressScheduleStatus } from '@erp/types';

import { usePhysicalFinancialSignal, useProgressCurve, useProjectRollup } from '../hooks/use-progress';

type SignalStatus = PhysicalFinancialSignalResponse['status'];

// Schedule/alignment chips ARE statuses (ahead/behind, aligned/cost-ahead), so they colour by
// meaning — matching the Performance view's mappings so the tab reads one vocabulary.
const SCHEDULE_TONE: Record<ProgressScheduleStatus, BadgeProps['tone']> = {
  AHEAD: 'live',
  ON_TRACK: 'info',
  BEHIND: 'warning',
  INSUFFICIENT_DATA: 'neutral',
};

const SIGNAL_TONE: Record<SignalStatus, BadgeProps['tone']> = {
  ALIGNED: 'live',
  COST_AHEAD: 'warning',
  PROGRESS_AHEAD: 'info',
  INSUFFICIENT_DATA: 'neutral',
};

/** `+5%`, `−3%`, `0%` with a real minus sign (ux-doctrine §3). */
function signedPercent(value: number): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value)}%`;
}

/**
 * The headline band the Progress tab opens with — the one place physical %, schedule, cost and
 * their alignment read as headline figures. It reads the same ADR-021 signals the Overview
 * cockpit card and the Performance view read, so the numbers can never disagree across surfaces.
 * A figure the system can't compute yet renders as an em-dash with a reason, never a misleading 0.
 */
export function ProgressHeadline({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const rollup = useProjectRollup(projectId);
  const signal = usePhysicalFinancialSignal(projectId);
  const curve = useProgressCurve(projectId);

  // Physical — the anchor figure (weighted work-package roll-up).
  const physicalValue = rollup.data ? `${rollup.data.physicalPercent}%` : null;
  const weightsNote: ReactNode =
    rollup.data && !rollup.data.weightsComplete ? (
      <Badge tone="warning">{t('headline.weightsIncomplete')}</Badge>
    ) : null;

  // Schedule — variance + status; honest "not enough data" when there's no baseline/snapshot.
  let scheduleValue: string | null = null;
  let scheduleNote: ReactNode = null;
  const c = curve.data;
  if (c && c.status !== 'INSUFFICIENT_DATA' && c.scheduleVariancePercent !== null) {
    scheduleValue = signedPercent(c.scheduleVariancePercent);
    scheduleNote = <Badge tone={SCHEDULE_TONE[c.status]}>{t(`curve.status.${c.status}`)}</Badge>;
  }

  // Cost consumed + alignment — from the physical-vs-financial signal.
  const sig = signal.data;
  const costValue = sig && sig.costConsumedPercent !== null ? `${sig.costConsumedPercent}%` : null;
  let alignmentValue: string | null = null;
  let alignmentNote: ReactNode = null;
  if (sig && sig.divergence !== null) {
    alignmentValue = signedPercent(sig.divergence);
    alignmentNote = <Badge tone={SIGNAL_TONE[sig.status]}>{t(`signal.status.${sig.status}`)}</Badge>;
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatTile
        label={t('headline.physical')}
        value={physicalValue}
        unavailableReason={rollup.isPending ? t('headline.loading') : t('headline.physicalNone')}
        note={weightsNote}
      />
      <StatTile
        label={t('headline.schedule')}
        value={scheduleValue}
        unavailableReason={curve.isPending ? t('headline.loading') : t('headline.scheduleNone')}
        note={scheduleNote}
      />
      <StatTile
        label={t('headline.cost')}
        value={costValue}
        unavailableReason={signal.isPending ? t('headline.loading') : t('headline.costNone')}
      />
      <StatTile
        label={t('headline.alignment')}
        value={alignmentValue}
        unavailableReason={signal.isPending ? t('headline.loading') : t('headline.alignmentNone')}
        note={alignmentNote}
      />
    </div>
  );
}
