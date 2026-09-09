'use client';

import { useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Alert, Badge, Button, DatePicker, Input, Label, SectionHeader, useToast } from '@erp/ui';
import { AlertTriangle, ShieldCheck, X } from 'lucide-react';

import type { ProgrammeBaselineResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { formatDate } from '@/lib/format';
import { usePermissions } from '@/features/auth/permissions/can';
import { useProject } from '@/features/projects/hooks/use-project';
import { useMilestones } from '@/features/programme/hooks/use-programme';

import {
  useApproveBaseline,
  useProgrammeBaseline,
  useProgressTargets,
  useSetProgressTargets,
} from '../hooks/use-progress';
import type { ProgressTargetItem } from '../api/progress-api';
import { RebaselineDialog } from './rebaseline-dialog';

interface Row {
  date: string;
  percent: string;
}

/** YYYY-MM-DD in UTC. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Monthly points on a straight 0→100% ramp between two dates — a starting shape the PM then adjusts. */
function monthlyLinearPoints(startIso: string, endIso: string): Row[] {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start) return [];
  const totalMs = end.getTime() - start.getTime();
  const rows: Row[] = [];
  const cursor = new Date(start);
  for (let guard = 0; cursor < end && guard < 120; guard += 1) {
    const frac = (cursor.getTime() - start.getTime()) / totalMs;
    rows.push({ date: iso(cursor), percent: String(Math.round(frac * 100)) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  rows.push({ date: iso(end), percent: '100' });
  return rows;
}

/**
 * Planned-baseline editor (ADR-021 CONST-PROG-011). A table of {date, cumulative %} points that is
 * the S-curve's planned line. Setting one un-provisions the curve — hence the two "start from"
 * generators (a linear ramp over the project dates, or one point per milestone), so the field is
 * never a blank the user has to invent from nothing. Validation mirrors the API: 0–100, unique
 * dates, non-decreasing over time. Saving an empty set clears the baseline (curve → provisional).
 */
export function BaselineSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const locale = useLocale() as 'en' | 'ar';
  const { toast } = useToast();
  const { can } = usePermissions();

  const targetsQuery = useProgressTargets(projectId);
  const baselineQuery = useProgrammeBaseline(projectId);
  const project = useProject(projectId);
  const milestones = useMilestones(projectId);
  const save = useSetProgressTargets(projectId);
  const approve = useApproveBaseline(projectId);

  // `rows === null` means "not yet edited" — mirror the server. Any edit makes it a concrete array
  // that the server no longer overwrites (until a save re-syncs it).
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rebaselineOpen, setRebaselineOpen] = useState(false);

  const serverRows: Row[] = useMemo(
    () =>
      (targetsQuery.data ?? []).map((p) => ({ date: p.targetDate, percent: String(p.cumulativePercent) })),
    [targetsQuery.data],
  );
  const current = rows ?? serverRows;
  const isSet = serverRows.length > 0;

  const governingBaseline = baselineQuery.data ?? null;
  const canApprove = can('manage:project');
  const canRebaseline = can('approve:project');

  // Does the saved working curve differ from the governing baseline's frozen points? Compared on
  // the *server truth* (serverRows), not the in-progress edit — an unsaved edit is not yet a staged
  // change, and an unpublished-changes hint driven by keystrokes would flicker. Both sides are
  // canonicalised (sorted by date, `date|percent`) so ordering never produces a false positive.
  const hasUnpublishedChanges = useMemo(() => {
    if (!governingBaseline) return false;
    const canon = (pts: Array<{ date: string; percent: number }>) =>
      pts
        .map((p) => `${p.date}|${p.percent}`)
        .sort()
        .join(',');
    const savedKey = canon(
      serverRows.map((r) => ({ date: r.date, percent: Number(r.percent) })),
    );
    const baselineKey = canon(
      governingBaseline.points.map((p) => ({
        date: p.targetDate,
        percent: p.cumulativePercent,
      })),
    );
    return savedKey !== baselineKey;
  }, [governingBaseline, serverRows]);

  // Project dates arrive from @db.Date columns as full ISO datetimes; slice to yyyy-MM-dd so the
  // DatePicker bounds (and the linear generator) get the calendar-date format they expect.
  const startDate = project.data?.startDate ? project.data.startDate.slice(0, 10) : null;
  const endDate = project.data?.expectedEndDate ? project.data.expectedEndDate.slice(0, 10) : null;
  const canLinear = Boolean(startDate && endDate);
  const milestoneCount = milestones.data?.length ?? 0;

  const update = (index: number, field: keyof Row, value: string) => {
    setError(null);
    setRows(current.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };
  const addRow = () => setRows([...current, { date: '', percent: '' }]);
  const removeRow = (index: number) => setRows(current.filter((_, i) => i !== index));

  const generateLinear = () => {
    if (!startDate || !endDate) return;
    setError(null);
    setRows(monthlyLinearPoints(startDate, endDate));
  };
  const deriveFromMilestones = () => {
    const ms = [...(milestones.data ?? [])].sort((a, b) => a.baselineDate.localeCompare(b.baselineDate));
    if (ms.length === 0) return;
    setError(null);
    setRows(ms.map((m, i) => ({ date: m.baselineDate, percent: String(Math.round(((i + 1) / ms.length) * 100)) })));
  };

  function validated(): ProgressTargetItem[] | null {
    const filled = current.filter((r) => r.date && r.percent !== '');
    const targets = filled.map((r) => ({ targetDate: r.date, cumulativePercent: Number(r.percent) }));
    const dates = new Set<string>();
    let prevPct = -1;
    const sorted = [...targets].sort((a, b) => a.targetDate.localeCompare(b.targetDate));
    for (const point of sorted) {
      if (point.cumulativePercent < 0 || point.cumulativePercent > 100 || Number.isNaN(point.cumulativePercent)) {
        setError(t('baseline.errorRange'));
        return null;
      }
      if (dates.has(point.targetDate)) {
        setError(t('baseline.errorDup'));
        return null;
      }
      if (point.cumulativePercent < prevPct) {
        setError(t('baseline.errorOrder'));
        return null;
      }
      dates.add(point.targetDate);
      prevPct = point.cumulativePercent;
    }
    return sorted;
  }

  function onSave() {
    const targets = validated();
    if (targets === null) return;
    save.mutate(targets, {
      onSuccess: () => {
        setRows(null); // re-sync from the (now-invalidated) server truth
        toast({ tone: 'success', title: t('baseline.saved') });
      },
      onError: (e) => setError(e instanceof ApiError ? e.message : t('states.loadFailed')),
    });
  }

  function onApprove() {
    setError(null);
    approve.mutate(undefined, {
      onSuccess: () => toast({ tone: 'success', title: t('baseline.governing.approved') }),
      onError: (e) =>
        setError(e instanceof ApiError ? e.message : t('baseline.governing.approveFailed')),
    });
  }

  const previewPoints = useMemo(() => {
    return current
      .filter((r) => r.date && r.percent !== '' && !Number.isNaN(Number(r.percent)))
      .map((r) => ({ date: r.date, percent: Math.max(0, Math.min(100, Number(r.percent))) }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [current]);

  return (
    <section className="space-y-4 rounded-panel border border-border bg-surface p-4 sm:p-5">
      <div>
        <SectionHeader title={t('baseline.title')} />
        <p className="mt-1 text-body-sm text-muted-foreground">{t('baseline.subtitle')}</p>
        <p className="mt-1 text-caption">
          {isSet ? (
            <Badge tone="live">{t('baseline.currentSet')}</Badge>
          ) : (
            <Badge tone="accent">{t('baseline.currentNone')}</Badge>
          )}
        </p>
      </div>

      <GoverningBaselineCard
        baseline={governingBaseline}
        loading={baselineQuery.isPending}
        hasUnpublishedChanges={hasUnpublishedChanges}
        locale={locale}
      />

      <p className="text-caption text-muted-foreground">{t('baseline.workingCurveNote')}</p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={generateLinear} disabled={!canLinear}>
          {t('baseline.generateLinear')}
        </Button>
        <Button variant="outline" size="sm" onClick={deriveFromMilestones} disabled={milestoneCount === 0}>
          {t('baseline.deriveMilestones')}
        </Button>
      </div>
      {!canLinear ? <p className="text-caption text-muted-foreground">{t('baseline.noDates')}</p> : null}

      {error ? <Alert variant="error" messages={[error]} /> : null}

      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('baseline.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {current.map((row, index) => (
            <li key={index} className="flex flex-wrap items-end gap-3">
              <div className="min-w-40 flex-1">
                <Label htmlFor={`bl-date-${index}`}>{t('baseline.colDate')}</Label>
                <DatePicker
                  id={`bl-date-${index}`}
                  value={row.date}
                  min={startDate ?? undefined}
                  max={endDate ?? undefined}
                  onChange={(value) => update(index, 'date', value)}
                />
              </div>
              <div className="w-28">
                <Label htmlFor={`bl-pct-${index}`}>{t('baseline.colPercent')}</Label>
                <Input
                  id={`bl-pct-${index}`}
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={row.percent}
                  onChange={(e) => update(index, 'percent', e.target.value)}
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeRow(index)}
                aria-label={t('baseline.remove')}
              >
                <X size={14} aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" onClick={addRow}>
          {t('baseline.addPoint')}
        </Button>
        {previewPoints.length >= 2 ? <BaselinePreview points={previewPoints} /> : null}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button onClick={onSave} disabled={save.isPending}>
          {t('baseline.save')}
        </Button>

        {/* Publish path: with no governing baseline this is the initial PM approve; once one exists
            it becomes the senior re-baseline that must cite a Variation. Each control is present
            only for the permission its endpoint enforces — an actor never sees a button that would
            only 403 (honesty §4). */}
        {!governingBaseline && canApprove ? (
          <Button
            variant="outline"
            onClick={onApprove}
            disabled={!isSet || approve.isPending}
            title={!isSet ? t('baseline.governing.approveNeedsCurve') : undefined}
          >
            {t('baseline.governing.approve')}
          </Button>
        ) : null}

        {governingBaseline && canRebaseline ? (
          <Button variant="outline" onClick={() => setRebaselineOpen(true)}>
            {t('baseline.governing.rebaseline')}
          </Button>
        ) : null}
      </div>

      {rebaselineOpen ? (
        <RebaselineDialog
          projectId={projectId}
          open={rebaselineOpen}
          onOpenChange={setRebaselineOpen}
        />
      ) : null}
    </section>
  );
}

/**
 * The governing-baseline card: the frozen, variance-driving plan (Master Schedule P3, ADR-029).
 * Distinct from the working-curve editor below it — that stages the next plan; this is what actuals
 * are currently measured against. Shows the version, who approved it and when, the cited Variation
 * (v≥2) and note, and a shape summary of the frozen curve. When the saved working curve has drifted
 * from these frozen points, a subtle "unpublished changes" hint says the plan is staged but not yet
 * governing — so nobody mistakes an edited-but-unpublished curve for the one driving variance.
 */
function GoverningBaselineCard({
  baseline,
  loading,
  hasUnpublishedChanges,
  locale,
}: {
  baseline: ProgrammeBaselineResponse | null;
  loading: boolean;
  hasUnpublishedChanges: boolean;
  locale: 'en' | 'ar';
}) {
  const t = useTranslations('progress');

  if (loading) return null;

  if (!baseline) {
    return (
      <div className="rounded-panel border border-dashed border-border bg-surface-subtle px-4 py-3">
        <p className="text-body-sm text-muted-foreground">{t('baseline.governing.none')}</p>
      </div>
    );
  }

  const points = baseline.points.map((p) => ({
    date: p.targetDate,
    percent: p.cumulativePercent,
  }));

  return (
    <div className="rounded-panel border border-border bg-surface-subtle px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-success" aria-hidden="true" />
          <span className="text-body-sm font-semibold text-foreground">
            {t('baseline.governing.versionLabel', { version: baseline.version })}
          </span>
        </div>
        {hasUnpublishedChanges ? (
          <Badge tone="warning">
            <AlertTriangle size={12} className="me-1 inline" aria-hidden="true" />
            {t('baseline.governing.unpublished')}
          </Badge>
        ) : null}
      </div>

      <p className="mt-1 text-caption text-muted-foreground">
        {t('baseline.governing.approvedBy', {
          who: baseline.approvedBy,
          date: formatDate(baseline.approvedAt, locale) ?? '—',
        })}
      </p>

      {baseline.variationOrderId ? (
        <p className="mt-0.5 text-caption text-muted-foreground">
          {t('baseline.governing.variationRef', { ref: baseline.variationOrderId })}
        </p>
      ) : null}

      {baseline.note ? (
        <p className="mt-1 text-body-sm text-foreground">{baseline.note}</p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {points.length >= 2 ? <BaselinePreview points={points} /> : null}
        <span className="text-caption text-muted-foreground">
          {t('baseline.governing.pointCount', { count: points.length })}
        </span>
      </div>

      {hasUnpublishedChanges ? (
        <p className="mt-2 text-caption text-warning">{t('baseline.governing.unpublishedHint')}</p>
      ) : null}
    </div>
  );
}

/** A tiny 0–100% sparkline of the entered curve — shape only, so the PM can sanity-check the plan. */
function BaselinePreview({ points }: { points: Array<{ date: string; percent: number }> }) {
  const t = useTranslations('progress');
  const W = 120;
  const H = 32;
  const first = new Date(points[0].date).getTime();
  const last = new Date(points[points.length - 1].date).getTime();
  const span = last - first || 1;
  const path = points
    .map((p) => {
      const x = ((new Date(p.date).getTime() - first) / span) * W;
      const y = H - (p.percent / 100) * H;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .map((c, i) => `${i === 0 ? 'M' : 'L'}${c}`)
    .join(' ');
  return (
    <span className="inline-flex items-center gap-2 text-caption text-muted-foreground">
      {t('baseline.preview')}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="overflow-visible" aria-hidden="true">
        <path d={path} fill="none" className="stroke-muted-foreground" strokeWidth={1.5} strokeDasharray="4 3" />
      </svg>
    </span>
  );
}
