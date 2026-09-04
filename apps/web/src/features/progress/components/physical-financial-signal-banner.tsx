'use client';

import { useTranslations } from 'next-intl';
import { Skeleton, type BadgeTone } from '@erp/ui';
import type { PhysicalFinancialSignalResponse } from '@erp/types';

import { usePhysicalFinancialSignal } from '../hooks/use-progress';
import { SignalBanner, formatPct, formatSignedPct } from './signal-banner';

type Status = PhysicalFinancialSignalResponse['status'];

const STATUS_TONE: Record<Status, BadgeTone> = {
  ALIGNED: 'live',
  COST_AHEAD: 'warning',
  PROGRESS_AHEAD: 'info',
  INSUFFICIENT_DATA: 'neutral',
};

const STATUS_HINT: Record<Status, string> = {
  ALIGNED: 'signal.alignedHint',
  COST_AHEAD: 'signal.costAheadHint',
  PROGRESS_AHEAD: 'signal.progressAheadHint',
  INSUFFICIENT_DATA: 'signal.insufficientHint',
};

/**
 * Finance-tab presentation of the ADR-021 physical-vs-financial signal: built % against cost
 * consumed %. Same read model as the Progress Performance view and the Overview card — one
 * source, three surfaces.
 */
export function PhysicalFinancialSignalBanner({
  projectId,
  showLink = true,
}: {
  projectId: string;
  /** Suppress the "Open Progress" link when the banner already sits inside the Progress tab. */
  showLink?: boolean;
}) {
  const t = useTranslations('progress');
  const q = usePhysicalFinancialSignal(projectId);

  if (q.isPending) return <Skeleton className="h-32 w-full" aria-hidden="true" />;
  // The Finance tab surfaces its own load errors; a failed signal stays quiet rather than
  // stacking a second error banner.
  if (q.isError) return null;

  const s = q.data;
  return (
    <SignalBanner
      headingId="signal-heading"
      title={t('signal.title')}
      statusLabel={t(`signal.status.${s.status}`)}
      tone={STATUS_TONE[s.status]}
      hint={t(STATUS_HINT[s.status])}
      stats={[
        { label: t('signal.physical'), value: `${s.physicalPercent}%` },
        { label: t('signal.cost'), value: formatPct(s.costConsumedPercent) },
        { label: t('signal.divergence'), value: formatSignedPct(s.divergence) },
      ]}
      link={showLink ? { href: `/projects/${projectId}/progress`, label: t('overview.link') } : undefined}
    />
  );
}
