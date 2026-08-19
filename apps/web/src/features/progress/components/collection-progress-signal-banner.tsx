'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Skeleton, type BadgeTone } from '@erp/ui';
import type { CollectionProgressSignalResponse } from '@erp/types';

import { useCollectionProgressSignal } from '../hooks/use-progress';

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
 * against work built (weighted physical %). Cash ahead of work is the client financing ACCO;
 * work ahead of cash is the reverse. Reads the backend collection-signal read model — no financial
 * ratio is computed on the client.
 */
export function CollectionProgressSignalBanner({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const q = useCollectionProgressSignal(projectId);

  if (q.isPending) return <Skeleton className="h-32 w-full" aria-hidden="true" />;
  if (q.isError) return null;

  const s = q.data;
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  const divergence =
    s.divergence === null ? '—' : `${s.divergence > 0 ? '+' : ''}${s.divergence}%`;

  return (
    <section
      aria-labelledby="collection-signal-heading"
      className="overflow-hidden rounded-panel border border-border bg-surface"
    >
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5">
        <h2 id="collection-signal-heading" className="text-body-sm font-semibold text-foreground">
          {t('collectionSignal.title')}
        </h2>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[s.status]}>{t(`collectionSignal.status.${s.status}`)}</Badge>
          <Link
            href={`/projects/${projectId}/commercial/billing-collection`}
            className="text-caption font-medium text-brand-primary hover:underline"
          >
            {t('collectionSignal.link')}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <Stat label={t('collectionSignal.collected')} value={pct(s.collectedPercent)} />
        <Stat label={t('signal.physical')} value={`${s.physicalPercent}%`} />
        <Stat label={t('signal.divergence')} value={divergence} />
      </div>

      <p className="border-t border-border px-5 py-3 text-caption text-muted-foreground">
        {t(STATUS_HINT[s.status])}
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-h3 font-bold tabular-nums text-foreground">{value}</p>
    </div>
  );
}
