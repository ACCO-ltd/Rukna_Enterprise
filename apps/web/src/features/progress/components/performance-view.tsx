'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import type { ProgressCurvePoint, WorkPackageRollupLine } from '@erp/types';
import {
  Alert,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  FormField,
  Progress,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { Ellipsis } from 'lucide-react';

import { MetricStrip, type Metric } from '@/components/widget/metric-strip';
import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { useMilestones } from '@/features/programme/hooks/use-programme';

import { localIsoDate } from '../domain/my-reports';
import {
  contributionPoints,
  curveCsv,
  packagePlannedPercent,
  planPosition,
  plannedPercentAt,
  round1,
} from '../domain/performance';
import {
  useCaptureProgressSnapshot,
  useCollectionProgressSignal,
  useDprs,
  usePhysicalFinancialSignal,
  useProgrammeBaseline,
  useProgressCurve,
  useProjectRollup,
} from '../hooks/use-progress';
import { ProgressCurveChart } from './progress-curve-chart';

/** A percentage the server may not have: a dash, never a fabricated 0. */
function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : `${round1(value)}%`;
}

/** A signed point figure with a real minus sign: "−3.5 pts", "+2 pts", "0 pts". */
function signed(value: number): string {
  const r = round1(value);
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`;
}

/**
 * Performance — what the numbers say, as percentages only. No money figure appears anywhere on
 * this view: the cost and collection signals are read as ratios, so a money-blind reader
 * (`moneyVisible: false`) sees exactly what everyone else sees here.
 *
 * - A metric strip: verified physical %, planned by today (from the LOCKED baseline only),
 *   variance in points, milestones verified.
 * - The S-curve: the locked baseline as a dashed line, verified progress (approved reports only)
 *   as the solid line, a today marker. No locked baseline → no planned line, and it says so.
 * - By work package: weight, % done, planned % from the package's planned dates, contribution.
 * - Needs attention: packages behind plan, built vs cost, collected vs built.
 */
export function PerformanceView({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en';
  const today = localIsoDate();

  const rollup = useProjectRollup(projectId);
  const baseline = useProgrammeBaseline(projectId);
  const curve = useProgressCurve(projectId);
  const dprs = useDprs(projectId);
  const milestones = useMilestones(projectId);

  // The planned line is the locked baseline — never a draft plan or the provisional estimate.
  const plannedPoints: ProgressCurvePoint[] = useMemo(
    () => (baseline.data?.points ?? []).map((p) => ({ periodEndDate: p.targetDate, plannedPercent: p.cumulativePercent })),
    [baseline.data],
  );
  const hasBaseline = Boolean(baseline.data) && plannedPoints.length > 0;

  if (rollup.isPending || baseline.isPending) {
    return (
      <div className="space-y-4" role="status" aria-live="polite">
        <Skeleton className="h-20 w-full rounded-panel" aria-hidden="true" />
        <Skeleton className="h-64 w-full rounded-panel" aria-hidden="true" />
      </div>
    );
  }
  if (rollup.isError || !rollup.data) {
    return <Alert variant="error" messages={[t('states.loadFailed')]} />;
  }

  const physical = rollup.data.physicalPercent;
  const lastApproved = [...(dprs.data ?? [])]
    .filter((d) => d.status === 'APPROVED')
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
  const plannedToday = hasBaseline ? plannedPercentAt(plannedPoints, today) : null;
  // A baseline whose first point is still ahead: the plan has not started (null), which is not 0%.
  const planNotStarted = hasBaseline && plannedToday === null;
  const variance = plannedToday === null ? null : physical - plannedToday;
  const position = variance === null ? null : planPosition(variance);
  // With weights short of 100% the physical figure is understated, so a variance built on it is
  // not a real signal: shown, but in the neutral tone (the view's notice says why).
  const flagBehind = position === 'behind' && rollup.data.weightsComplete;
  const milestoneList = milestones.data ?? [];

  const metrics: Metric[] = [
    {
      label: t('performance.physical'),
      value: pct(physical),
      sublabel: lastApproved
        ? t('performance.verifiedTo', { date: formatDate(lastApproved.reportDate, locale) ?? lastApproved.reportDate })
        : t('performance.noVerified'),
    },
    {
      label: t('performance.planned'),
      value: plannedToday === null ? null : pct(plannedToday),
      sublabel: !hasBaseline
        ? t('performance.noBaseline')
        : planNotStarted
          ? t('performance.planNotStarted')
          : t('performance.baselineOf', { date: formatDate(baseline.data!.approvedAt, locale) ?? '' }),
    },
    {
      label: t('performance.variance'),
      value: variance === null ? null : t('performance.variancePts', { value: signed(variance) }),
      tone: flagBehind ? 'warning' : undefined,
      sublabel:
        position !== null
          ? t(`performance.${position}`)
          : planNotStarted
            ? t('performance.planNotStarted')
            : t('performance.noBaseline'),
      sublabelTone: flagBehind ? 'attention' : undefined,
    },
    {
      label: t('performance.milestones'),
      value: milestones.isPending
        ? null
        : t('performance.milestonesValue', {
            verified: milestoneList.filter((m) => m.status === 'VERIFIED').length,
            total: milestoneList.length,
          }),
    },
  ];

  const packages = rollup.data.packages;

  return (
    <div className="space-y-6">
      <MetricStrip metrics={metrics} columns={4} aria-label={t('performance.metricsLabel')} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <CurvePanel
            projectId={projectId}
            plannedPoints={hasBaseline ? plannedPoints : []}
            plannedToday={plannedToday}
            curve={curve}
            today={today}
          />
          <PackagesTable packages={packages} today={today} />
        </div>
        <AttentionRail projectId={projectId} packages={packages} today={today} />
      </div>
    </div>
  );
}

// ─── S-curve ──────────────────────────────────────────────────────────────────────────────

function CurvePanel({
  projectId,
  plannedPoints,
  plannedToday,
  curve,
  today,
}: {
  projectId: string;
  plannedPoints: ProgressCurvePoint[];
  plannedToday: number | null;
  curve: ReturnType<typeof useProgressCurve>;
  today: string;
}) {
  const t = useTranslations('progress');
  const { can } = usePermissions();
  const [recording, setRecording] = useState(false);

  const actual = curve.data?.actual ?? [];
  const canRecord = can('manage:project');
  const canExport = actual.length > 0 || plannedPoints.length > 0;

  function onExport() {
    const csv = curveCsv(plannedPoints, actual, {
      date: t('performance.csvDate'),
      planned: t('performance.csvPlanned'),
      verified: t('performance.csvVerified'),
    });
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `progress-curve-${today}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="performance-curve-title" className="rounded-panel border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
        <h3 id="performance-curve-title" className="text-body font-semibold text-foreground">
          {t('performance.curveTitle')}
        </h3>
        {canRecord || canExport ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={t('performance.more')} title={t('performance.more')}>
                <Ellipsis size={18} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {canRecord ? (
                <DropdownMenuItem onSelect={() => setRecording(true)}>{t('performance.recordSnapshot')}</DropdownMenuItem>
              ) : null}
              {canExport ? <DropdownMenuItem onSelect={onExport}>{t('performance.export')}</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>
      <div className="space-y-3 px-4 py-4 sm:px-5">
        {curve.isPending ? (
          <Skeleton className="h-56 w-full" aria-hidden="true" />
        ) : curve.isError ? (
          <Alert variant="error" messages={[t('states.loadFailed')]} />
        ) : actual.length === 0 && plannedPoints.length === 0 ? (
          <p className="text-body-sm text-muted-foreground">{t('performance.curveEmpty')}</p>
        ) : (
          <ProgressCurveChart
            baseline={plannedPoints}
            actual={actual}
            actualSeries="verified"
            today={today}
            plannedToday={plannedToday}
          />
        )}
        {plannedPoints.length === 0 ? (
          <p className="text-caption text-muted-foreground">{t('performance.curveNoBaseline')}</p>
        ) : null}
      </div>
      {recording ? <SnapshotDialog projectId={projectId} onDismiss={() => setRecording(false)} /> : null}
    </section>
  );
}

function SnapshotDialog({ projectId, onDismiss }: { projectId: string; onDismiss: () => void }) {
  const t = useTranslations('progress');
  const capture = useCaptureProgressSnapshot(projectId);
  const [date, setDate] = useState(localIsoDate());

  const error = capture.isError
    ? capture.error instanceof ApiError && capture.error.status === 409
      ? t('curve.capture.alreadyRecorded')
      : t('curve.capture.failed')
    : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !capture.isPending) onDismiss();
      }}
    >
      <DialogContent size="sm">
        <DialogTitle>{t('performance.snapshotTitle')}</DialogTitle>
        <DialogDescription>{t('performance.snapshotHint')}</DialogDescription>
        {error ? (
          <div className="mt-4">
            <Alert variant="error" messages={[error]} />
          </div>
        ) : null}
        <div className="mt-4">
          <FormField htmlFor="snapshot-as-of" label={t('performance.snapshotDate')}>
            <DatePicker id="snapshot-as-of" value={date} max={localIsoDate()} onChange={setDate} />
          </FormField>
        </div>
        <DialogFooter>
          <Button
            onClick={() => capture.mutate({ periodEndDate: date }, { onSuccess: onDismiss })}
            disabled={capture.isPending || !date}
          >
            {t('performance.snapshotConfirm')}
          </Button>
          <Button variant="outline" onClick={onDismiss} disabled={capture.isPending}>
            {t('performance.snapshotCancel')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── By work package ──────────────────────────────────────────────────────────────────────

function PackagesTable({ packages, today }: { packages: WorkPackageRollupLine[]; today: string }) {
  const t = useTranslations('progress');
  return (
    <section aria-labelledby="performance-packages-title" className="space-y-2">
      <h3 id="performance-packages-title" className="text-body font-semibold text-foreground">
        {t('performance.packagesTitle')}
      </h3>
      <TableScroll aria-label={t('performance.packagesTitle')}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('performance.col.package')}</TableHead>
              <TableHead numeric>{t('performance.col.weight')}</TableHead>
              <TableHead>{t('performance.col.done')}</TableHead>
              <TableHead numeric>{t('performance.col.planned')}</TableHead>
              <TableHead numeric>{t('performance.col.contribution')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {packages.map((p) => {
              const planned = p.scheduleOnly ? null : packagePlannedPercent(p.plannedStart, p.plannedEnd, today);
              const behind = planned !== null && p.percentComplete !== null && p.percentComplete < planned;
              const contribution = contributionPoints(p.weight, p.percentComplete);
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="block font-medium">{p.name}</span>
                    <span className="block font-mono text-caption text-muted-foreground">{p.code}</span>
                  </TableCell>
                  <TableCell numeric>{`${Math.round(Number(p.weight) * 100)}%`}</TableCell>
                  <TableCell className="min-w-32">
                    {p.percentComplete === null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Progress
                          value={p.percentComplete}
                          size="sm"
                          tone={p.percentComplete >= 100 ? 'success' : 'default'}
                          label={`${p.code} ${p.percentComplete}%`}
                        />
                        <span className="w-10 shrink-0 text-end text-caption tabular-nums">{`${p.percentComplete}%`}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell numeric className={behind ? 'font-medium text-warning' : undefined}>
                    {planned === null ? '—' : `${planned}%`}
                  </TableCell>
                  <TableCell numeric>
                    {contribution === null ? '—' : t('performance.contributionValue', { value: contribution })}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableScroll>
      <p className="text-caption text-muted-foreground">{t('performance.packagesNote')}</p>
    </section>
  );
}

// ─── Needs attention ──────────────────────────────────────────────────────────────────────

function AttentionRail({
  projectId,
  packages,
  today,
}: {
  projectId: string;
  packages: WorkPackageRollupLine[];
  today: string;
}) {
  const t = useTranslations('progress');
  const { can } = usePermissions();
  const cost = usePhysicalFinancialSignal(projectId);
  const collection = useCollectionProgressSignal(projectId);

  const behind = packages.flatMap((p) => {
    if (p.scheduleOnly || p.percentComplete === null) return [];
    const planned = packagePlannedPercent(p.plannedStart, p.plannedEnd, today);
    return planned !== null && p.percentComplete < planned ? [{ ...p, planned, done: p.percentComplete }] : [];
  });

  const linkClass = 'text-body-sm font-medium text-brand-primary hover:underline';
  // Only a real warning is "needs attention": cost running ahead of what is built, or cash and
  // work out of step either way. ALIGNED / PROGRESS_AHEAD / INSUFFICIENT_DATA are left out, so the
  // rail can honestly say nothing needs attention.
  const costWarning = cost.data && cost.data.status === 'COST_AHEAD' ? cost.data : null;
  const collectionWarning =
    collection.data && (collection.data.status === 'WORK_AHEAD' || collection.data.status === 'CASH_AHEAD')
      ? collection.data
      : null;

  return (
    <aside aria-labelledby="performance-attention-title" className="min-w-0 space-y-3">
      <h3 id="performance-attention-title" className="text-body font-semibold text-foreground">
        {t('performance.attentionTitle')}
      </h3>
      <ul className="divide-y divide-border rounded-panel border border-border bg-surface">
        {behind.length > 0 ? (
          <li className="space-y-1 px-4 py-3">
            <p className="text-body-sm font-semibold text-warning">
              {t('performance.behindCount', { count: behind.length })}
            </p>
            <ul className="space-y-0.5 text-body-sm text-foreground">
              {behind.map((p) => (
                <li key={p.id}>
                  {t('performance.behindPackage', { code: p.code, name: p.name, done: p.done, planned: p.planned })}
                </li>
              ))}
            </ul>
          </li>
        ) : null}

        {costWarning ? (
          <li className="space-y-1 px-4 py-3">
            <p className="text-body-sm font-semibold text-foreground">{t('performance.costTitle')}</p>
            <p className="text-body-sm text-muted-foreground">{t(`signal.status.${costWarning.status}`)}</p>
            <p className="text-body-sm text-foreground">
              {t('performance.costLine', { built: pct(costWarning.physicalPercent), cost: pct(costWarning.costConsumedPercent) })}
            </p>
            {can('view:financial-position') ? (
              <Link href={`/projects/${projectId}/finance`} className={linkClass}>
                {t('performance.openFinance')}
              </Link>
            ) : null}
          </li>
        ) : null}

        {collectionWarning ? (
          <li className="space-y-1 px-4 py-3">
            <p className="text-body-sm font-semibold text-foreground">{t('performance.collectionTitle')}</p>
            <p className="text-body-sm text-muted-foreground">{t(`collectionSignal.status.${collectionWarning.status}`)}</p>
            <p className="text-body-sm text-foreground">
              {t('performance.collectionLine', {
                collected: pct(collectionWarning.collectedPercent),
                built: pct(collectionWarning.physicalPercent),
              })}
            </p>
            {can('view:contract') ? (
              <Link href={`/projects/${projectId}/commercial/billing`} className={linkClass}>
                {t('performance.openBilling')}
              </Link>
            ) : null}
          </li>
        ) : null}

        {behind.length === 0 && !costWarning && !collectionWarning ? (
          <li className="px-4 py-3 text-body-sm text-muted-foreground">{t('performance.attentionClear')}</li>
        ) : null}
      </ul>
    </aside>
  );
}
