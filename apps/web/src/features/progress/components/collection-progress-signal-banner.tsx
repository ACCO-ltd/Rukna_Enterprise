'use client';

import { useTranslations } from 'next-intl';
import { Skeleton, type BadgeTone } from '@erp/ui';
import type { CollectionProgressSignalResponse } from '@erp/types';

import { useCollectionProgressSignal } from '../hooks/use-progress';
import { SignalBanner, formatPct, formatSignedPct } from './signal-banner';

type Status = CollectionProgressSignalResponse['status'];

const STATUS_TONE: Record<Status, BadgeTone> = {
  ALIGNED: 'live',
  CASH_AHEAD: 'info',
  WORK_AHEAD: 'warning',
  INSUFFICIENT_DATA: 'neutral',
};

const STATUS_HINT: Record<Status, string> = {
  ALIGNED: 'collectionSignal.alignedHint',
  CASH_AHEAD: 'collectionSignal.cashAheadHint',
  WORK_AHEAD: 'collectionSignal.workAheadHint',
  INSUFFICIENT_DATA: 'collectionSignal.insufficientHint',
};

/**
 * Collection-vs-progress early warning (ADR-021/023): cash collected (received ÷ contract value)
 * against work built (weighted physical %). Reads the backend collection-signal read model — no
 * financial ratio is computed on the client.
 */
export function CollectionProgressSignalBanner({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const q = useCollectionProgressSignal(projectId);

  if (q.isPending) return <Skeleton className="h-32 w-full" aria-hidden="true" />;
  if (q.isError) return null;

  const s = q.data;
  return (
    <SignalBanner
      headingId="collection-signal-heading"
      title={t('collectionSignal.title')}
      statusLabel={t(`collectionSignal.status.${s.status}`)}
      tone={STATUS_TONE[s.status]}
      hint={t(STATUS_HINT[s.status])}
      stats={[
        { label: t('collectionSignal.collected'), value: formatPct(s.collectedPercent) },
        { label: t('signal.physical'), value: `${s.physicalPercent}%` },
        { label: t('signal.divergence'), value: formatSignedPct(s.divergence) },
      ]}
      link={{
        href: `/projects/${projectId}/commercial/billing-collection`,
        label: t('collectionSignal.link'),
      }}
    />
  );
}
