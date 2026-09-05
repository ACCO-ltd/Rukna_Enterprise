'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import type { ProgressScheduleStatus } from '@erp/types';

import { formatDate } from '@/lib/format';

import {
  useProgressCurve,
  useProgressPeriodComparison,
  useProjectRollup,
} from '../hooks/use-progress';

/** `+5.0` / `−3.0` / `0` with a real minus sign (ux-doctrine §3). */
function signed(value: number, digits = 1): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${Math.abs(value).toFixed(digits)}`;
}

/**
 * The four figures the Progress tab opens with.
 *
 * They answer one question each, in the order somebody asks them: how far along are we, how much
 * did that move, where should we be, and does that add up to a problem. The last three are all
 * derived from the same curve read as the first, so the strip can never disagree with itself.
 *
 * `scheduleVariancePercent` is `actual − planned` at the latest actual point, which makes planned
 * progress exactly `actual − variance` — computed, not a second server call and not an estimate.
 *
 * A figure the system cannot compute yet reads as an em-dash with the reason underneath, never a
 * misleading zero. On a project with no baseline that is three of the four, and saying so plainly
 * is the honest shape of an unconfigured project.
 */
export function ProgressHeadline({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en' | 'ar';
  const rollup = useProjectRollup(projectId);
  const curve = useProgressCurve(projectId);
  const comparison = useProgressPeriodComparison(projectId);

  const physical = rollup.data?.physicalPercent ?? null;

  const c = curve.data;
  const hasPlan =
    c !== undefined && c.status !== 'INSUFFICIENT_DATA' && c.scheduleVariancePercent !== null;
  const variance = hasPlan ? c.scheduleVariancePercent! : null;
  // planned = actual − (actual − planned). One read, two figures, no second opinion.
  const plannedToDate =
    hasPlan && physical !== null ? Math.round((physical - variance!) * 10) / 10 : null;
  const asOf = c?.actual.at(-1)?.periodEndDate ?? null;

  const period = comparison.data?.physical ?? null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metric
        label={t('headline.physical')}
        value={physical === null ? null : `${physical}%`}
        delta={
          variance === null
            ? null
            : { text: `${signed(variance)} pp`, direction: variance < 0 ? 'down' : 'up' }
        }
        support={
          plannedToDate === null
            ? t('headline.physicalNoPlan')
            : t('headline.physicalVsPlanned', { planned: `${plannedToDate}%` })
        }
        pending={rollup.isPending}
        emptyReason={t('headline.physicalNone')}
      />

      <Metric
        label={t('headline.thisPeriod')}
        value={period === null ? null : `${signed(period.delta)}%`}
        support={
          period === null
            ? t('headline.noPeriod')
            : t('headline.sinceLast', { previous: `${period.previous}%` })
        }
        pending={comparison.isPending}
        emptyReason={t('headline.noPeriod')}
        tone={period === null ? 'default' : period.delta > 0 ? 'success' : 'default'}
      />

      <Metric
        label={t('headline.planned')}
        value={plannedToDate === null ? null : `${plannedToDate}%`}
        support={
          asOf === null
            ? undefined
            : t('headline.plannedAsOf', { date: formatDate(asOf, locale) ?? '—' })
        }
        pending={curve.isPending}
        emptyReason={t('headline.scheduleNone')}
      />

      <StatusMetric
        label={t('headline.status')}
        status={hasPlan ? c.status : null}
        variance={variance}
        pending={curve.isPending}
        emptyReason={t('headline.scheduleNone')}
      />
    </div>
  );
}

// ─── Tiles ────────────────────────────────────────────────────────────────────

/**
 * Panels rather than an open metric strip. Four figures at this weight need an edge each, or the
 * eye reads them as one run-on sentence — which is what the previous flat row did at 1440.
 */
const TILE = 'min-w-0 rounded-panel border border-border bg-surface p-4';

function Metric({
  label,
  value,
  delta,
  support,
  pending,
  emptyReason,
  tone = 'default',
}: {
  label: string;
  value: string | null;
  delta?: { text: string; direction: 'up' | 'down' } | null;
  support?: string | undefined;
  pending: boolean;
  emptyReason: string;
  tone?: 'default' | 'success';
}) {
  return (
    <div className={TILE}>
      <p className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>

      {pending ? (
        <div className="mt-2 h-8 w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
      ) : value === null ? (
        <>
          <p className="mt-1.5 text-h1 font-bold text-muted-foreground">—</p>
          <p className="mt-1 text-caption text-muted-foreground">{emptyReason}</p>
        </>
      ) : (
        <>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
            <span
              className={cn(
                'text-display font-bold tabular-nums',
                tone === 'success' ? 'text-success' : 'text-foreground',
              )}
            >
              {value}
            </span>
            {delta ? (
              <span
                className={cn(
                  'text-caption font-semibold tabular-nums',
                  // Variance against plan is a state, not money — colour is carried by the
                  // arrow as well as the hue, so it survives greyscale.
                  delta.direction === 'down' ? 'text-danger' : 'text-success',
                )}
              >
                <span aria-hidden="true">{delta.direction === 'down' ? '▾' : '▴'}</span>{' '}
                {delta.text}
              </span>
            ) : null}
          </div>
          {support ? <p className="mt-1 text-caption text-muted-foreground">{support}</p> : null}
        </>
      )}
    </div>
  );
}

const STATUS_DOT: Record<ProgressScheduleStatus, string> = {
  AHEAD: 'bg-success',
  ON_TRACK: 'bg-success',
  BEHIND: 'bg-warning',
  INSUFFICIENT_DATA: 'bg-muted-foreground',
};

function StatusMetric({
  label,
  status,
  variance,
  pending,
  emptyReason,
}: {
  label: string;
  status: ProgressScheduleStatus | null;
  variance: number | null;
  pending: boolean;
  emptyReason: string;
}) {
  const t = useTranslations('progress');

  return (
    <div className={TILE}>
      <p className="text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {label}
      </p>

      {pending ? (
        <div className="mt-2 h-8 w-28 animate-pulse rounded bg-muted" aria-hidden="true" />
      ) : status === null ? (
        <>
          <p className="mt-1.5 text-h1 font-bold text-muted-foreground">—</p>
          <p className="mt-1 text-caption text-muted-foreground">{emptyReason}</p>
        </>
      ) : (
        <>
          {/* The dot repeats what the label says, so nothing depends on colour alone. */}
          <p className="mt-2 flex items-center gap-2 text-h2 font-bold text-foreground">
            <span
              aria-hidden="true"
              className={cn('h-2.5 w-2.5 shrink-0 rounded-full', STATUS_DOT[status])}
            />
            {t(`curve.status.${status}`)}
          </p>
          <p className="mt-1.5 text-caption text-muted-foreground">
            {variance === null || variance === 0
              ? t('headline.statusOnPlan')
              : t('headline.statusPoints', { points: Math.abs(variance).toFixed(1) })}
          </p>
        </>
      )}
    </div>
  );
}
