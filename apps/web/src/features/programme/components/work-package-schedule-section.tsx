'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  SectionHeader,
  Skeleton,
  cn,
  type BadgeProps,
} from '@erp/ui';
import { CalendarClock } from 'lucide-react';
import type { ProgressScheduleStatus, WorkPackageRollupLine } from '@erp/types';

import { EmptyState } from '@/components/empty-state';
import { useProject } from '@/features/projects/hooks/use-project';
import { useBoqLeaves } from '@/features/progress/hooks/use-boq-leaves';
import { useProjectRollup } from '@/features/progress/hooks/use-progress';

const dateOnly = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const msOf = (iso: string): number => new Date(iso).getTime();

/**
 * Same status vocabulary the headline band and Performance chip use — the dot repeats the badge
 * word so nothing depends on colour alone (ux-doctrine §1). The bars themselves stay on the
 * `--chart-*` ramp (data-viz, not status); only this dot/badge colours by meaning.
 */
const STATUS_DOT: Record<ProgressScheduleStatus, string> = {
  AHEAD: 'bg-success',
  ON_TRACK: 'bg-success',
  BEHIND: 'bg-warning',
  INSUFFICIENT_DATA: 'bg-muted-foreground',
};

const STATUS_TONE: Record<ProgressScheduleStatus, BadgeProps['tone']> = {
  AHEAD: 'live',
  ON_TRACK: 'info',
  BEHIND: 'warning',
  INSUFFICIENT_DATA: 'neutral',
};

/**
 * Master Schedule P1-c (ADR-029): the **work package is the schedule row**.
 *
 * In the Progress → Schedule view, each work package renders as a plan-vs-actual timeline row —
 * a planned bar (`plannedStart → plannedEnd`) with a derived-actual bar overlaid
 * (`actualStart → actualFinish`, or an open/ongoing bar to today when work has started but not
 * finished), a % chip (`percentComplete`, "—" for a schedule-only phase), and a schedule-status
 * dot/badge. All of these are consumed from the per-package roll-up read-model — % complete and
 * actual dates are DERIVED on read, never stored, and never invented here.
 *
 * Sub-phase activities remain optional detail beneath this section, unchanged (`ActivitiesSection`).
 */
export function WorkPackageScheduleSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const rollup = useProjectRollup(projectId);
  const project = useProject(projectId);
  const { hasBaseline, isPending: baselinePending } = useBoqLeaves(projectId);

  if (rollup.isPending || project.isPending || baselinePending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <Skeleton className="h-48 w-full" aria-hidden="true" />
      </div>
    );
  }

  if (rollup.isError) {
    return (
      <Alert variant="error" messages={[t('states.loadFailed')]}>
        <div className="mt-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void rollup.refetch()}
            disabled={rollup.isFetching}
          >
            {t('actions.retry')}
          </Button>
        </div>
      </Alert>
    );
  }

  const packages = rollup.data.packages;

  // State 1 — no BOQ baseline: the schedule can't be built (scope is assigned against BOQ leaves),
  // so mirror the allocation gate's hint instead of an empty grid.
  if (!hasBaseline) {
    return (
      <section className="space-y-4">
        <ScheduleHeader t={t} />
        <EmptyState
          variant="page"
          icon={<CalendarClock size={28} strokeWidth={1.6} aria-hidden="true" />}
          title={t('wpSchedule.noBaselineTitle')}
          description={t('wpSchedule.noBaseline')}
        />
      </section>
    );
  }

  // State 2 — no schedule yet: no work package carries planned dates. Lead with a clear
  // "Set up schedule" CTA, not an empty timeline. (The guided wizard is P1-d; this is the entry.)
  const scheduled = packages.filter((p) => p.plannedStart && p.plannedEnd);
  if (scheduled.length === 0) {
    return (
      <section className="space-y-4">
        <ScheduleHeader t={t} />
        <EmptyState
          variant="page"
          icon={<CalendarClock size={28} strokeWidth={1.6} aria-hidden="true" />}
          title={t('wpSchedule.emptyTitle')}
          description={
            packages.length === 0
              ? t('wpSchedule.emptyNoPackages')
              : t('wpSchedule.emptyNoDates')
          }
        />
      </section>
    );
  }

  // State 3 — partial: some phases still lack planned dates. Note how many, then draw what we have.
  const undatedCount = packages.length - scheduled.length;

  const projectStart = project.data?.startDate ? project.data.startDate.slice(0, 10) : null;
  const projectEnd = project.data?.expectedEndDate
    ? project.data.expectedEndDate.slice(0, 10)
    : null;

  return (
    <section className="space-y-4">
      <ScheduleHeader t={t} />

      {undatedCount > 0 ? (
        <Alert variant="info" messages={[t('wpSchedule.partial', { count: undatedCount })]} />
      ) : null}

      <ScheduleTimeline
        packages={packages}
        projectStart={projectStart}
        projectEnd={projectEnd}
      />
    </section>
  );
}

function ScheduleHeader({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <div>
      <SectionHeader title={t('wpSchedule.title')} />
      <p className="mt-1 text-body-sm text-muted-foreground">{t('wpSchedule.subtitle')}</p>
    </div>
  );
}

/**
 * The plan-vs-actual timeline. Each dated work package is one row: a track carrying the planned bar
 * (`--chart-1`) with the derived-actual bar overlaid beneath it (`--chart-2`, dashed while ongoing),
 * plus the % chip and the status dot/badge. Bars are percentage-positioned across the project
 * window exactly like the activity Gantt-lite, so the two read as one language.
 */
function ScheduleTimeline({
  packages,
  projectStart,
  projectEnd,
}: {
  packages: WorkPackageRollupLine[];
  projectStart: string | null;
  projectEnd: string | null;
}) {
  const t = useTranslations('progress');

  const dated = packages.filter((p) => p.plannedStart && p.plannedEnd);

  // Today anchors an ongoing actual bar (started, not finished) and extends the axis so a run that
  // overruns the planned window still renders inside the track rather than clipping off the end.
  // Frozen once per mount via a lazy initialiser — a plain `Date.now()` in render is impure and
  // would drift on every re-render.
  const [todayMs] = useState(() => msOf(isoOf(Date.now())));

  const plannedStarts = dated.map((p) => msOf(p.plannedStart as string));
  const plannedEnds = dated.map((p) => msOf(p.plannedEnd as string));
  const actualPoints = packages.flatMap((p) => {
    const pts: number[] = [];
    if (p.actualStart) pts.push(msOf(p.actualStart));
    if (p.actualFinish) pts.push(msOf(p.actualFinish));
    else if (p.actualStart) pts.push(todayMs);
    return pts;
  });

  const axisStart = Math.min(
    ...plannedStarts,
    ...actualPoints,
    ...(projectStart ? [msOf(projectStart)] : []),
  );
  const axisEnd = Math.max(
    ...plannedEnds,
    ...actualPoints,
    ...(projectEnd ? [msOf(projectEnd)] : []),
  );
  const span = axisEnd - axisStart || 1;
  const pct = (ms: number) => ((ms - axisStart) / span) * 100;
  const clampPct = (ms: number) => Math.min(100, Math.max(0, pct(ms)));

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between text-micro font-semibold uppercase text-muted-foreground">
        <span className="tabular-nums tracking-normal">{isoOf(axisStart)}</span>
        <span>{t('wpSchedule.timeline')}</span>
        <span className="tabular-nums tracking-normal">{isoOf(axisEnd)}</span>
      </div>

      {/* Legend — the two bar meanings, and that the actual is derived, stated once. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-control bg-chart-1" aria-hidden="true" />
          {t('wpSchedule.legend.planned')}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-4 rounded-control bg-chart-2" aria-hidden="true" />
          {t('wpSchedule.legend.actual')}
        </span>
      </div>

      <div className="overflow-x-auto">
        <ul className="min-w-[32rem] space-y-3">
          {packages.map((p) => (
            <ScheduleRow
              key={p.id}
              line={p}
              clampPct={clampPct}
              todayMs={todayMs}
            />
          ))}
        </ul>
      </div>
    </div>
  );
}

function ScheduleRow({
  line,
  clampPct,
  todayMs,
}: {
  line: WorkPackageRollupLine;
  clampPct: (ms: number) => number;
  todayMs: number;
}) {
  const t = useTranslations('progress');

  const hasPlanned = Boolean(line.plannedStart && line.plannedEnd);
  const plannedLeft = hasPlanned ? clampPct(msOf(line.plannedStart as string)) : 0;
  const plannedRight = hasPlanned ? clampPct(msOf(line.plannedEnd as string)) : 0;

  // Ongoing = work started (actualStart) but not complete (no actualFinish): draw an open bar to
  // today, marked as ongoing so it never reads as a finished, closed run.
  const ongoing = Boolean(line.actualStart && !line.actualFinish);
  const actualEndMs = line.actualFinish
    ? msOf(line.actualFinish)
    : ongoing
      ? todayMs
      : null;
  const actualLeft = line.actualStart ? clampPct(msOf(line.actualStart)) : 0;
  const actualRight = actualEndMs !== null ? clampPct(actualEndMs) : 0;

  const plannedRange = hasPlanned
    ? `${dateOnly(line.plannedStart)} → ${dateOnly(line.plannedEnd)}`
    : t('wpSchedule.noDates');
  const actualRange = line.actualStart
    ? line.actualFinish
      ? `${dateOnly(line.actualStart)} → ${dateOnly(line.actualFinish)}`
      : t('wpSchedule.actualOngoing', { start: dateOnly(line.actualStart) })
    : t('wpSchedule.actualNone');

  return (
    <li className="space-y-1.5">
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">{line.code}</span>
        <span className="min-w-0 flex-1 truncate text-caption font-semibold text-foreground" title={line.name}>
          {line.name}
        </span>
        {line.scheduleOnly ? (
          <Badge tone="neutral">{t('wpSchedule.scheduleOnly')}</Badge>
        ) : null}
        <PercentChip percent={line.percentComplete} label={t('wpSchedule.percentLabel')} />
        <StatusBadge status={line.scheduleStatus} />
      </div>

      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0" aria-hidden="true" />
        {/* The track holds the planned bar on top and the derived-actual bar below it. */}
        <span
          className="relative block h-6 min-w-0 flex-1 rounded-control bg-muted"
          role="img"
          aria-label={`${line.name}: ${t('wpSchedule.planned')} ${plannedRange}; ${t('wpSchedule.actual')} ${actualRange}`}
        >
          {hasPlanned ? (
            <span
              className="absolute inset-x-0 top-1 h-2 rounded-control bg-chart-1"
              style={{
                left: `${plannedLeft}%`,
                right: 'auto',
                width: `${Math.max(1.5, plannedRight - plannedLeft)}%`,
              }}
              title={`${t('wpSchedule.planned')} · ${plannedRange}`}
            />
          ) : null}

          {line.actualStart && actualEndMs !== null ? (
            <span
              className={cn(
                'absolute bottom-1 h-2 rounded-control bg-chart-2',
                ongoing && 'border border-dashed border-chart-2 bg-chart-2/40',
              )}
              style={{
                left: `${actualLeft}%`,
                width: `${Math.max(1.5, actualRight - actualLeft)}%`,
              }}
              title={`${t('wpSchedule.actual')} · ${actualRange}`}
            />
          ) : line.actualStart ? (
            // Started exactly today (no measurable span yet) — a marker, not a zero-width bar.
            <span
              className="absolute bottom-1 top-auto h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-chart-2"
              style={{ left: `${actualLeft}%` }}
              title={`${t('wpSchedule.actual')} · ${actualRange}`}
            />
          ) : null}
        </span>
      </div>
    </li>
  );
}

/** The derived % for the package — a schedule-only phase has none, so it reads "—", never 0%. */
function PercentChip({ percent, label }: { percent: number | null; label: string }) {
  if (percent === null) {
    return (
      <span
        className="w-12 shrink-0 text-end text-caption tabular-nums text-muted-foreground"
        aria-label={label}
      >
        —
      </span>
    );
  }
  return (
    <span
      className="w-12 shrink-0 text-end text-caption font-semibold tabular-nums text-foreground"
      aria-label={label}
    >
      {`${percent}%`}
    </span>
  );
}

/** Schedule health for the phase — dot + word, so the meaning never rides on colour alone. */
function StatusBadge({ status }: { status: ProgressScheduleStatus }) {
  const t = useTranslations('progress');
  return (
    <Badge tone={STATUS_TONE[status]} className="shrink-0 gap-1.5">
      <span
        aria-hidden="true"
        className={cn('h-1.5 w-1.5 shrink-0 rounded-full', STATUS_DOT[status])}
      />
      {t(`curve.status.${status}`)}
    </Badge>
  );
}
