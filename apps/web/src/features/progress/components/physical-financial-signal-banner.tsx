'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge, Skeleton, type BadgeTone } from '@erp/ui';
import type { PhysicalFinancialSignalResponse } from '@erp/types';

import { usePhysicalFinancialSignal } from '../hooks/use-progress';

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
 * Finance-tab presentation of the ADR-021 physical-vs-financial signal: built % against cost
 * consumed %, so a project spending ahead of its progress is visible next to the Financial
 * Position it is drawn from. Same read model as the Progress tab's Performance view and the
 * Overview card — one source, three surfaces.
 */
export function PhysicalFinancialSignalBanner({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const q = usePhysicalFinancialSignal(projectId);

  if (q.isPending) return <Skeleton className="h-32 w-full" aria-hidden="true" />;
  // The Finance tab already surfaces its own load errors; a failed signal stays quiet rather
  // than stacking a second error banner.
  if (q.isError) return null;

  const s = q.data;
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
  const divergence =
    s.divergence === null ? '—' : `${s.divergence > 0 ? '+' : ''}${s.divergence}%`;

  return (
    <section aria-labelledby="signal-heading" className="overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex min-h-12 items-center justify-between gap-3 border-b border-border px-5">
        <h2 id="signal-heading" className="text-body-sm font-semibold text-foreground">
          {t('signal.title')}
        </h2>
        <div className="flex items-center gap-3">
          <Badge tone={STATUS_TONE[s.status]}>{t(`signal.status.${s.status}`)}</Badge>
          <Link
            href={`/projects/${projectId}/progress`}
            className="text-caption font-medium text-brand-primary hover:underline"
          >
            {t('overview.link')}
          </Link>
        </div>
      </div>

      <div className="grid gap-4 px-5 py-4 sm:grid-cols-3">
        <Stat label={t('signal.physical')} value={`${s.physicalPercent}%`} />
        <Stat label={t('signal.cost')} value={pct(s.costConsumedPercent)} />
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
