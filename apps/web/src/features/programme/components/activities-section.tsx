'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Alert,
  Badge,
  Button,
  DatePicker,
  Dialog,
  DialogContent,
  DialogTitle,
  FormField,
  Input,
  SectionHeader,
  Skeleton,
} from '@erp/ui';

import { ApiError } from '@/lib/api-client';
import { EmptyState } from '@/components/empty-state';
import { useProject } from '@/features/projects/hooks/use-project';
import { useWorkPackages } from '@/features/progress/hooks/use-progress';

import {
  useCreateActivity,
  useDeleteActivity,
  useProgrammeActivities,
  useUpdateActivity,
} from '../hooks/use-programme';
import type { ProgrammeActivityResponse } from '../api/programme-api';

const dateOnly = (iso: string | null): string => (iso ? iso.slice(0, 10) : '');
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * Programme activities — the WBS/time layer under each work package (ADR-021 CONST-PROG-005),
 * finally given a UI. A planned-bar timeline (Gantt-lite, no dependency arrows — deliberately
 * deferred) over a per-work-package breakdown. Activities are created/edited/deleted in a dialog;
 * dates are bounded to the project window so they can't be entered outside it.
 */
export function ActivitiesSection({ projectId }: { projectId: string }) {
  const t = useTranslations('progress');
  const tCommon = useTranslations('common');
  const wps = useWorkPackages(projectId);
  const activitiesQuery = useProgrammeActivities(projectId);
  const project = useProject(projectId);

  const [dialog, setDialog] = useState<{
    workPackageId: string;
    activity: ProgrammeActivityResponse | null;
  } | null>(null);

  if (wps.isPending || activitiesQuery.isPending) {
    return (
      <div role="status" aria-live="polite">
        <span className="sr-only">{tCommon('loading')}</span>
        <Skeleton className="h-48 w-full" aria-hidden="true" />
      </div>
    );
  }

  const packages = wps.data ?? [];
  const activities = activitiesQuery.data ?? [];

  if (packages.length === 0) {
    return (
      <EmptyState
        variant="page"
        title={t('activity.noWorkPackagesTitle')}
        description={t('activity.noWorkPackages')}
      />
    );
  }

  const byWp = new Map<string, ProgrammeActivityResponse[]>();
  for (const wp of packages) byWp.set(wp.id, []);
  for (const a of activities) byWp.get(a.workPackageId)?.push(a);

  const projectStart = project.data?.startDate ?? null;
  const projectEnd = project.data?.expectedEndDate ?? null;

  return (
    <div className="space-y-5">
      <div>
        <SectionHeader title={t('activity.title')} />
        <p className="mt-1 text-body-sm text-muted-foreground">{t('activity.subtitle')}</p>
      </div>

      <GanttLite packages={packages} byWp={byWp} projectStart={projectStart} projectEnd={projectEnd} />

      {packages.map((wp) => {
        const acts = byWp.get(wp.id) ?? [];
        return (
          <div key={wp.id} className="space-y-2">
            <SectionHeader title={`${wp.code} · ${wp.name}`}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDialog({ workPackageId: wp.id, activity: null })}
              >
                {t('activity.add')}
              </Button>
            </SectionHeader>
            {acts.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>
            ) : (
              <ul className="divide-y divide-border rounded-panel border border-border">
                {acts.map((a) => {
                  const range =
                    a.plannedStart && a.plannedEnd
                      ? `${dateOnly(a.plannedStart)} → ${dateOnly(a.plannedEnd)}`
                      : a.plannedStart
                        ? dateOnly(a.plannedStart)
                        : t('activity.noDates');
                  return (
                    <li key={a.id}>
                      <button
                        type="button"
                        onClick={() => setDialog({ workPackageId: wp.id, activity: a })}
                        className="flex w-full items-center gap-3 px-3 py-2 text-start text-sm hover:bg-surface-subtle focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
                      >
                        <span className="w-16 shrink-0 font-mono text-xs text-muted-foreground">
                          {a.code}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-foreground">{a.name}</span>
                        {a.isMilestone ? <Badge tone="info">{t('activity.col.milestone')}</Badge> : null}
                        <span className="shrink-0 tabular-nums text-caption text-muted-foreground">
                          {range}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      {dialog ? (
        <ActivityDialog
          projectId={projectId}
          workPackageId={dialog.workPackageId}
          activity={dialog.activity}
          projectStart={projectStart}
          projectEnd={projectEnd}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </div>
  );
}

/** A percentage-positioned planned-bar timeline. Bars are the data-viz colour, never a status. */
function GanttLite({
  packages,
  byWp,
  projectStart,
  projectEnd,
}: {
  packages: Array<{ id: string; code: string; name: string }>;
  byWp: Map<string, ProgrammeActivityResponse[]>;
  projectStart: string | null;
  projectEnd: string | null;
}) {
  const t = useTranslations('progress');

  const dated = packages.flatMap((wp) =>
    (byWp.get(wp.id) ?? []).filter((a) => a.plannedStart && a.plannedEnd),
  );
  if (dated.length === 0) return null;

  const starts = dated.map((a) => new Date(a.plannedStart as string).getTime());
  const ends = dated.map((a) => new Date(a.plannedEnd as string).getTime());
  const axisStart = Math.min(...starts, ...(projectStart ? [new Date(projectStart).getTime()] : []));
  const axisEnd = Math.max(...ends, ...(projectEnd ? [new Date(projectEnd).getTime()] : []));
  const span = axisEnd - axisStart || 1;
  const pct = (ms: number) => ((ms - axisStart) / span) * 100;

  return (
    <div className="rounded-panel border border-border bg-surface p-4">
      <div className="mb-2 flex items-center justify-between text-micro font-semibold uppercase text-muted-foreground">
        <span className="tabular-nums tracking-normal">{isoOf(axisStart)}</span>
        <span>{t('activity.timeline')}</span>
        <span className="tabular-nums tracking-normal">{isoOf(axisEnd)}</span>
      </div>
      <div className="overflow-x-auto">
        <div className="min-w-[28rem] space-y-3">
          {packages.map((wp) => {
            const acts = (byWp.get(wp.id) ?? []).filter((a) => a.plannedStart);
            if (acts.length === 0) return null;
            return (
              <div key={wp.id}>
                <p className="text-caption font-semibold text-foreground">
                  {wp.code} · {wp.name}
                </p>
                <ul className="mt-1 space-y-1">
                  {acts.map((a) => {
                    const startMs = new Date(a.plannedStart as string).getTime();
                    const endMs = a.plannedEnd ? new Date(a.plannedEnd).getTime() : null;
                    return (
                      <li key={a.id} className="flex items-center gap-3">
                        <span
                          className="w-32 shrink-0 truncate text-caption text-muted-foreground"
                          title={a.name}
                        >
                          {a.name}
                        </span>
                        <span className="relative h-4 flex-1 rounded bg-muted">
                          {endMs !== null ? (
                            <span
                              className="absolute inset-y-0 rounded bg-chart-1"
                              style={{
                                left: `${pct(startMs)}%`,
                                width: `${Math.max(1.5, pct(endMs) - pct(startMs))}%`,
                              }}
                              title={`${dateOnly(a.plannedStart)} → ${dateOnly(a.plannedEnd)}`}
                            />
                          ) : (
                            <span
                              className="absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rotate-45 bg-chart-2"
                              style={{ left: `${pct(startMs)}%` }}
                              title={dateOnly(a.plannedStart)}
                            />
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ActivityDialog({
  projectId,
  workPackageId,
  activity,
  projectStart,
  projectEnd,
  onClose,
}: {
  projectId: string;
  workPackageId: string;
  activity: ProgrammeActivityResponse | null;
  projectStart: string | null;
  projectEnd: string | null;
  onClose: () => void;
}) {
  const t = useTranslations('progress');
  const isEdit = activity !== null;
  const create = useCreateActivity(projectId);
  const update = useUpdateActivity(projectId);
  const remove = useDeleteActivity(projectId);

  const [code, setCode] = useState(activity?.code ?? '');
  const [name, setName] = useState(activity?.name ?? '');
  const [start, setStart] = useState(dateOnly(activity?.plannedStart ?? null));
  const [end, setEnd] = useState(dateOnly(activity?.plannedEnd ?? null));
  const [isMilestone, setIsMilestone] = useState(activity?.isMilestone ?? false);
  const [touched, setTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const codeError = touched && !code.trim() ? t('activity.codeRequired') : undefined;
  const nameError = touched && !name.trim() ? t('activity.nameRequired') : undefined;
  const dateError = start && end && end < start ? t('activity.dateOrder') : undefined;
  const busy = create.isPending || update.isPending || remove.isPending;

  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : t('states.loadFailed'));

  function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!code.trim() || !name.trim() || dateError) return;
    if (isEdit) {
      update.mutate(
        {
          activityId: activity.id,
          body: {
            name: name.trim(),
            plannedStart: start || null,
            plannedEnd: end || null,
            isMilestone,
          },
        },
        { onSuccess: onClose, onError },
      );
    } else {
      create.mutate(
        {
          workPackageId,
          body: {
            code: code.trim(),
            name: name.trim(),
            plannedStart: start || undefined,
            plannedEnd: end || undefined,
            isMilestone,
          },
        },
        { onSuccess: onClose, onError },
      );
    }
  }

  function onDelete() {
    if (!isEdit) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    remove.mutate(activity.id, { onSuccess: onClose, onError });
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o && !busy) onClose();
      }}
    >
      <DialogContent className="p-5 sm:p-6 sm:max-w-lg">
        <DialogTitle>{isEdit ? t('activity.editTitle') : t('activity.addTitle')}</DialogTitle>
        <form onSubmit={onSubmit} className="mt-5">
          {error ? (
            <div className="mb-3">
              <Alert variant="error" messages={[error]} />
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <FormField htmlFor="act-code" label={t('activity.form.code')} error={codeError}>
              <Input
                id="act-code"
                value={code}
                disabled={isEdit}
                onChange={(e) => setCode(e.target.value)}
              />
            </FormField>
            <FormField htmlFor="act-name" label={t('activity.form.name')} error={nameError}>
              <Input id="act-name" value={name} onChange={(e) => setName(e.target.value)} />
            </FormField>
            <FormField htmlFor="act-start" label={t('activity.form.start')}>
              <DatePicker
                id="act-start"
                value={start}
                min={projectStart ?? undefined}
                max={projectEnd ?? undefined}
                onChange={setStart}
              />
            </FormField>
            <FormField htmlFor="act-end" label={t('activity.form.end')} error={dateError}>
              <DatePicker
                id="act-end"
                value={end}
                min={start || projectStart || undefined}
                max={projectEnd ?? undefined}
                onChange={setEnd}
              />
            </FormField>
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={isMilestone}
              onChange={(e) => setIsMilestone(e.target.checked)}
              className="h-4 w-4"
            />
            {t('activity.form.milestone')}
          </label>
          <div className="mt-4 flex items-center justify-between gap-2">
            <Button type="submit" disabled={busy}>
              {t('activity.save')}
            </Button>
            {isEdit ? (
              <Button
                type="button"
                variant={confirmDelete ? 'destructive' : 'ghost'}
                onClick={onDelete}
                disabled={busy}
              >
                {confirmDelete ? t('activity.confirmDelete') : t('activity.delete')}
              </Button>
            ) : null}
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
