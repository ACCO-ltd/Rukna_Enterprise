'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Alert, Badge, Button, DatePicker, Input, Label, SectionHeader, useToast } from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { useProject } from '@/features/projects/hooks/use-project';
import { useMilestones } from '@/features/programme/hooks/use-programme';

import { useProgressTargets, useSetProgressTargets } from '../hooks/use-progress';
import type { ProgressTargetItem } from '../api/progress-api';

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
  const { toast } = useToast();

  const targetsQuery = useProgressTargets(projectId);
  const project = useProject(projectId);
  const milestones = useMilestones(projectId);
  const save = useSetProgressTargets(projectId);

  // `rows === null` means "not yet edited" — mirror the server. Any edit makes it a concrete array
  // that the server no longer overwrites (until a save re-syncs it).
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const serverRows: Row[] = useMemo(
    () =>
      (targetsQuery.data ?? []).map((p) => ({ date: p.targetDate, percent: String(p.cumulativePercent) })),
    [targetsQuery.data],
  );
  const current = rows ?? serverRows;
  const isSet = serverRows.length > 0;

  const startDate = project.data?.startDate ?? null;
  const endDate = project.data?.expectedEndDate ?? null;
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
                ×
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

      <div>
        <Button onClick={onSave} disabled={save.isPending}>
          {t('baseline.save')}
        </Button>
      </div>
    </section>
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
