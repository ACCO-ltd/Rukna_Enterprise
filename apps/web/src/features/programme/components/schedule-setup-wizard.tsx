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
  Label,
  Select,
  cn,
} from '@erp/ui';
import { LayoutTemplate, PencilRuler } from 'lucide-react';
import type { WorkPackageRollupLine } from '@erp/types';

import { ProgressStepper, type Step as StepperStep } from '@/components/progress-stepper';
import { useProject } from '@/features/projects/hooks/use-project';
import { useBoqLeaves, lineLabel, type ClaimableLine } from '@/features/progress/hooks/use-boq-leaves';
import {
  useAllocateToWorkPackage,
  useProjectRollup,
} from '@/features/progress/hooks/use-progress';
import { ApiError } from '@/lib/api-client';

import {
  useApplyScheduleTemplate,
  useSuggestWeights,
  useUpdateWorkPackage,
} from '../hooks/use-programme';

/**
 * Master Schedule P1-d (ADR-029) — the guided schedule-setup wizard.
 *
 * The anti-frustration core of the master schedule: instead of dropping the user onto an empty
 * work-package grid, a four-step flow walks them from an ACCO template (or a blank start) → BOQ
 * scope per phase → planned dates → weights, and closes onto the live Schedule timeline (P1-c).
 *
 * Every step reads the same per-package roll-up the rest of Progress reads, and writes only through
 * the endpoints that already exist: `apply-schedule-template`, `allocate`, the WP PATCH, and the
 * read-only `suggest-weights`. % complete and actual dates are derived on read and never set here.
 *
 * The wizard is a controlled `Dialog`; the caller owns `open` and gates the entry on a BOQ baseline.
 */
export function ScheduleSetupWizard({
  projectId,
  open,
  onOpenChange,
}: {
  projectId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('progress');
  const tw = useTranslations('progress.scheduleWizard');

  const rollup = useProjectRollup(projectId);
  const project = useProject(projectId);
  const { leaves, hasBaseline, isPending: leavesPending } = useBoqLeaves(projectId);

  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  const packages = rollup.data?.packages ?? [];

  const stepLabels = [tw('steps.step1'), tw('steps.step2'), tw('steps.step3'), tw('steps.step4')];
  const stepperSteps: StepperStep[] = stepLabels.map((label, i) => {
    const n = (i + 1) as 1 | 2 | 3 | 4;
    return {
      id: String(n),
      label,
      status: n < step ? 'complete' : n === step ? 'current' : 'upcoming',
    };
  });

  const projectStart = project.data?.startDate ? project.data.startDate.slice(0, 10) : null;
  const projectEnd = project.data?.expectedEndDate
    ? project.data.expectedEndDate.slice(0, 10)
    : null;

  const ready = !rollup.isPending && !project.isPending && !leavesPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-5 sm:max-w-3xl sm:p-6">
        <DialogTitle>{tw('title')}</DialogTitle>
        <p className="mt-1 text-body-sm text-muted-foreground">{tw('subtitle')}</p>

        <div className="mt-5">
          <ProgressStepper steps={stepperSteps} />
        </div>

        <div className="mt-6">
          {!ready ? (
            <div role="status" aria-live="polite">
              <span className="sr-only">{t('states.loading')}</span>
              <div
                className="h-48 animate-pulse rounded-panel border border-border bg-muted"
                aria-hidden="true"
              />
            </div>
          ) : rollup.isError ? (
            <Alert variant="error" messages={[t('states.loadFailed')]} />
          ) : !hasBaseline ? (
            // The wizard should not have opened without a baseline (the entry gates on it), but if
            // the baseline was cleared while open, say so rather than offer a broken flow.
            <Alert variant="warning" messages={[tw('noBaseline')]} />
          ) : step === 1 ? (
            <StepStart
              projectId={projectId}
              hasPackages={packages.length > 0}
              onDone={() => setStep(2)}
              onCancel={() => onOpenChange(false)}
            />
          ) : step === 2 ? (
            <StepScope
              projectId={projectId}
              packages={packages}
              leaves={leaves}
              onBack={() => setStep(1)}
              onNext={() => setStep(3)}
            />
          ) : step === 3 ? (
            <StepDates
              projectId={projectId}
              packages={packages}
              projectStart={projectStart}
              projectEnd={projectEnd}
              onBack={() => setStep(2)}
              onNext={() => setStep(4)}
            />
          ) : (
            <StepWeights
              projectId={projectId}
              packages={packages}
              weightsComplete={rollup.data?.weightsComplete ?? false}
              weightsTotal={rollup.data?.weightsTotal ?? '0'}
              onBack={() => setStep(3)}
              onFinish={() => {
                setStep(1);
                onOpenChange(false);
              }}
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Step 1 — Start ─────────────────────────────────────────────────────────────────────────

/**
 * Choose a starting point: apply ACCO's standard building template (pre-creates the nine phases so
 * the user edits rather than invents), or start blank and add phases by hand. The template apply is
 * only offered when the project has no work packages yet — the endpoint 409s otherwise, and a
 * silent duplicate is worse than a disabled option.
 */
function StepStart({
  projectId,
  hasPackages,
  onDone,
  onCancel,
}: {
  projectId: string;
  hasPackages: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  const apply = useApplyScheduleTemplate(projectId);
  const [error, setError] = useState<string | null>(null);

  function applyTemplate() {
    setError(null);
    apply.mutate('ACCO_STANDARD_BUILDING', {
      onSuccess: () => onDone(),
      onError: (e) => setError(e instanceof ApiError ? e.message : tw('start.applyFailed')),
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">{tw('start.lead')}</p>

      {error ? <Alert variant="error" messages={[error]} /> : null}

      {hasPackages ? (
        <Alert variant="info" messages={[tw('start.alreadyHasPackages')]} />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={applyTemplate}
          disabled={hasPackages || apply.isPending}
          className={cn(
            'flex min-h-[7rem] flex-col gap-2 rounded-panel border border-border bg-surface p-4 text-start',
            'transition-colors hover:border-border-interactive focus-visible:outline-none focus-visible:shadow-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <LayoutTemplate size={20} strokeWidth={1.8} aria-hidden="true" className="text-brand-primary" />
          <span className="text-body-sm font-semibold text-foreground">{tw('start.templateTitle')}</span>
          <span className="text-caption text-muted-foreground">{tw('start.templateHint')}</span>
        </button>

        <button
          type="button"
          onClick={onDone}
          className={cn(
            'flex min-h-[7rem] flex-col gap-2 rounded-panel border border-border bg-surface p-4 text-start',
            'transition-colors hover:border-border-interactive focus-visible:outline-none focus-visible:shadow-ring',
          )}
        >
          <PencilRuler size={20} strokeWidth={1.8} aria-hidden="true" className="text-muted-foreground" />
          <span className="text-body-sm font-semibold text-foreground">{tw('start.blankTitle')}</span>
          <span className="text-caption text-muted-foreground">{tw('start.blankHint')}</span>
        </button>
      </div>

      <div className="flex justify-between pt-1">
        <Button variant="ghost" onClick={onCancel}>
          {tw('nav.cancel')}
        </Button>
        {apply.isPending ? (
          <span className="self-center text-caption text-muted-foreground">{tw('start.applying')}</span>
        ) : null}
      </div>
    </div>
  );
}

// ─── Step 2 — Assign scope ──────────────────────────────────────────────────────────────────

/**
 * Assign BOQ leaves to phases, with live coverage. Each measurable phase shows how many items it
 * carries and offers a picker to allocate one more; a phase with no measurable scope can be marked
 * schedule-only (Design, Mobilization) so it is tracked by dates alone rather than reading a
 * misleading 0%. An unassigned-leaves banner keeps the user honest about scope that counts towards
 * nothing yet.
 */
function StepScope({
  projectId,
  packages,
  leaves,
  onBack,
  onNext,
}: {
  projectId: string;
  packages: WorkPackageRollupLine[];
  leaves: ClaimableLine[];
  onBack: () => void;
  onNext: () => void;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  const allocate = useAllocateToWorkPackage(projectId);
  const setScheduleOnly = useUpdateWorkPackage(projectId);
  const [error, setError] = useState<string | null>(null);

  const measurable = packages.filter((p) => !p.scheduleOnly);
  const assignedCount = measurable.reduce((sum, p) => sum + p.leafCount, 0);
  const unassignedCount = Math.max(0, leaves.length - assignedCount);

  function onAllocate(workPackageId: string, boqNodeId: string) {
    setError(null);
    allocate.mutate(
      { workPackageId, boqNodeId },
      { onError: (e) => setError(e instanceof ApiError ? e.message : tw('scope.allocateFailed')) },
    );
  }

  function onToggleScheduleOnly(workPackageId: string, next: boolean) {
    setError(null);
    setScheduleOnly.mutate(
      { workPackageId, body: { scheduleOnly: next } },
      { onError: (e) => setError(e instanceof ApiError ? e.message : tw('scope.scheduleOnlyFailed')) },
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">{tw('scope.lead')}</p>

      {packages.length === 0 ? (
        <Alert variant="info" messages={[tw('scope.noPackages')]} />
      ) : null}

      {error ? <Alert variant="error" messages={[error]} /> : null}

      {unassignedCount > 0 ? (
        <Alert variant="warning" messages={[tw('scope.unassigned', { count: unassignedCount })]} />
      ) : leaves.length > 0 ? (
        <Alert variant="success" messages={[tw('scope.allAssigned')]} />
      ) : null}

      <ul className="space-y-2">
        {packages.map((p) => (
          <ScopeRow
            key={p.id}
            line={p}
            leaves={leaves}
            allocating={allocate.isPending}
            onAllocate={(boqNodeId) => onAllocate(p.id, boqNodeId)}
            onToggleScheduleOnly={(next) => onToggleScheduleOnly(p.id, next)}
          />
        ))}
      </ul>

      <StepNav onBack={onBack} onNext={onNext} nextLabel={tw('nav.next')} />
    </div>
  );
}

function ScopeRow({
  line,
  leaves,
  allocating,
  onAllocate,
  onToggleScheduleOnly,
}: {
  line: WorkPackageRollupLine;
  leaves: ClaimableLine[];
  allocating: boolean;
  onAllocate: (boqNodeId: string) => void;
  onToggleScheduleOnly: (next: boolean) => void;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  const [boqNodeId, setBoqNodeId] = useState('');
  const selectId = `scope-${line.id}`;

  return (
    <li className="rounded-panel border border-border bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{line.code}</span>
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground" title={line.name}>
          {line.name}
        </span>
        {line.scheduleOnly ? (
          <Badge tone="neutral">{tw('scope.scheduleOnlyBadge')}</Badge>
        ) : (
          <Badge tone="info">{tw('scope.itemCount', { count: line.leafCount })}</Badge>
        )}
      </div>

      {line.scheduleOnly ? (
        <div className="mt-2 flex items-center justify-between">
          <span className="text-caption text-muted-foreground">{tw('scope.scheduleOnlyHint')}</span>
          <Button variant="ghost" size="sm" onClick={() => onToggleScheduleOnly(false)}>
            {tw('scope.makeMeasurable')}
          </Button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <Label htmlFor={selectId} className="sr-only">
            {tw('scope.pickItem')}
          </Label>
          <div className="flex items-center gap-2">
            <Select
              id={selectId}
              value={boqNodeId}
              onChange={(value) => setBoqNodeId(value)}
              className="flex-1"
            >
              <option value="">{tw('scope.pickItem')}</option>
              {leaves.map((leaf) => (
                <option key={leaf.id} value={leaf.id}>
                  {lineLabel(leaf)}
                </option>
              ))}
            </Select>
            <Button
              variant="outline"
              size="sm"
              disabled={!boqNodeId || allocating}
              onClick={() => {
                onAllocate(boqNodeId);
                setBoqNodeId('');
              }}
            >
              {tw('scope.assign')}
            </Button>
          </div>
          {line.leafCount === 0 ? (
            <button
              type="button"
              onClick={() => onToggleScheduleOnly(true)}
              className="text-caption font-semibold text-brand-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-ring"
            >
              {tw('scope.markScheduleOnly')}
            </button>
          ) : null}
        </div>
      )}
    </li>
  );
}

// ─── Step 3 — Dates ─────────────────────────────────────────────────────────────────────────

/** Add days to an ISO `yyyy-MM-dd`, in UTC to stay off the local-midnight shift. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Set each phase's planned window. Auto-suggest sequences the phases back-to-back from the project
 * start using each phase's template duration (falling back to 30 days when a phase has none), which
 * the user can then override per row. Dates persist through the WP PATCH; min/max clamp selection to
 * the project window when it is known.
 */
function StepDates({
  projectId,
  packages,
  projectStart,
  projectEnd,
  onBack,
  onNext,
}: {
  projectId: string;
  packages: WorkPackageRollupLine[];
  projectStart: string | null;
  projectEnd: string | null;
  onBack: () => void;
  onNext: () => void;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  const update = useUpdateWorkPackage(projectId);
  const [error, setError] = useState<string | null>(null);

  const undated = packages.filter((p) => !p.plannedStart || !p.plannedEnd).length;

  function persist(workPackageId: string, plannedStart: string | null, plannedEnd: string | null) {
    setError(null);
    update.mutate(
      { workPackageId, body: { plannedStart, plannedEnd } },
      { onError: (e) => setError(e instanceof ApiError ? e.message : tw('dates.saveFailed')) },
    );
  }

  function autoSuggest() {
    if (!projectStart) return;
    setError(null);
    let cursor = projectStart;
    for (const p of packages) {
      const duration = p.durationDays && p.durationDays > 0 ? p.durationDays : 30;
      const start = cursor;
      // A duration of N days spans start .. start + (N-1); the next phase starts the day after.
      const end = addDays(start, Math.max(0, duration - 1));
      update.mutate(
        { workPackageId: p.id, body: { plannedStart: start, plannedEnd: end } },
        { onError: (e) => setError(e instanceof ApiError ? e.message : tw('dates.saveFailed')) },
      );
      cursor = addDays(end, 1);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body-sm text-muted-foreground">{tw('dates.lead')}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={autoSuggest}
          disabled={!projectStart || update.isPending || packages.length === 0}
        >
          {tw('dates.autoSuggest')}
        </Button>
      </div>

      {!projectStart ? (
        <Alert variant="info" messages={[tw('dates.noProjectStart')]} />
      ) : null}

      {error ? <Alert variant="error" messages={[error]} /> : null}

      <ul className="space-y-2">
        {packages.map((p) => (
          <DatesRow
            key={p.id}
            line={p}
            min={projectStart ?? undefined}
            max={projectEnd ?? undefined}
            onChange={(start, end) => persist(p.id, start, end)}
          />
        ))}
      </ul>

      <StepNav
        onBack={onBack}
        onNext={onNext}
        nextLabel={undated > 0 ? tw('dates.nextWithUndated', { count: undated }) : tw('nav.next')}
      />
    </div>
  );
}

function DatesRow({
  line,
  min,
  max,
  onChange,
}: {
  line: WorkPackageRollupLine;
  min?: string;
  max?: string;
  onChange: (start: string | null, end: string | null) => void;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  const [start, setStart] = useState(line.plannedStart ?? '');
  const [end, setEnd] = useState(line.plannedEnd ?? '');

  const orderError = start && end && end < start ? tw('dates.orderError') : null;

  return (
    <li className="rounded-panel border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-xs text-muted-foreground">{line.code}</span>
        <span className="min-w-0 flex-1 truncate text-body-sm font-semibold text-foreground" title={line.name}>
          {line.name}
        </span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label htmlFor={`start-${line.id}`}>{tw('dates.start')}</Label>
          <DatePicker
            id={`start-${line.id}`}
            value={start}
            min={min}
            max={max}
            placeholder={tw('dates.pickDate')}
            onChange={(value) => {
              setStart(value);
              onChange(value || null, end || null);
            }}
          />
        </div>
        <div>
          <Label htmlFor={`end-${line.id}`}>{tw('dates.end')}</Label>
          <DatePicker
            id={`end-${line.id}`}
            value={end}
            min={start || min}
            max={max}
            placeholder={tw('dates.pickDate')}
            onChange={(value) => {
              setEnd(value);
              onChange(start || null, value || null);
            }}
          />
        </div>
      </div>
      {orderError ? <p className="mt-1 text-caption text-danger">{orderError}</p> : null}
    </li>
  );
}

// ─── Step 4 — Weights & review ──────────────────────────────────────────────────────────────

/**
 * Distribute weights and review. "Distribute by BOQ value" calls `suggest-weights` (assigned value ÷
 * total assigned value) and writes each measurable phase's `progressWeight` via the WP PATCH, so the
 * user is not left guessing. The reconcile check mirrors the roll-up's `weightsComplete`; a review
 * list names any phase still missing scope or dates before Finish closes onto the live schedule.
 */
function StepWeights({
  projectId,
  packages,
  weightsComplete,
  weightsTotal,
  onBack,
  onFinish,
}: {
  projectId: string;
  packages: WorkPackageRollupLine[];
  weightsComplete: boolean;
  weightsTotal: string;
  onBack: () => void;
  onFinish: () => void;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  const suggest = useSuggestWeights(projectId);
  const update = useUpdateWorkPackage(projectId);
  const [error, setError] = useState<string | null>(null);

  const totalPercent = Math.round(Number(weightsTotal) * 100);

  const missingScope = packages.filter((p) => !p.scheduleOnly && p.leafCount === 0);
  const missingDates = packages.filter((p) => !p.plannedStart || !p.plannedEnd);

  function distribute() {
    setError(null);
    suggest.mutate(undefined, {
      onSuccess: (res) => {
        for (const w of res.weights) {
          update.mutate(
            { workPackageId: w.workPackageId, body: { progressWeight: Number(w.suggestedWeight.toFixed(4)) } },
            { onError: (e) => setError(e instanceof ApiError ? e.message : tw('weights.saveFailed')) },
          );
        }
      },
      onError: (e) => setError(e instanceof ApiError ? e.message : tw('weights.suggestFailed')),
    });
  }

  const busy = suggest.isPending || update.isPending;

  return (
    <div className="space-y-4">
      <p className="text-body-sm text-muted-foreground">{tw('weights.lead')}</p>

      {error ? <Alert variant="error" messages={[error]} /> : null}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-panel border border-border bg-surface p-3">
        <div>
          <p className="text-caption text-muted-foreground">{tw('weights.totalLabel')}</p>
          <p className="text-h3 font-semibold tabular-nums text-foreground">{`${totalPercent}%`}</p>
          <p className="mt-0.5 text-caption">
            {weightsComplete ? (
              <span className="text-success">{tw('weights.complete')}</span>
            ) : (
              <span className="text-warning">
                {tw('weights.remaining', { remaining: Math.max(0, 100 - totalPercent) })}
              </span>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={distribute} disabled={busy || packages.length === 0}>
          {tw('weights.distribute')}
        </Button>
      </div>

      <ul className="space-y-1.5">
        {packages.map((p) => (
          <li
            key={p.id}
            className="flex items-center gap-2 rounded-control border border-border bg-surface px-3 py-2"
          >
            <span className="font-mono text-xs text-muted-foreground">{p.code}</span>
            <span className="min-w-0 flex-1 truncate text-body-sm text-foreground" title={p.name}>
              {p.name}
            </span>
            <span className="tabular-nums text-body-sm font-semibold text-foreground">
              {`${Math.round(Number(p.weight) * 100)}%`}
            </span>
          </li>
        ))}
      </ul>

      {missingScope.length > 0 ? (
        <Alert variant="warning" messages={[tw('weights.missingScope', { count: missingScope.length })]} />
      ) : null}
      {missingDates.length > 0 ? (
        <Alert variant="info" messages={[tw('weights.missingDates', { count: missingDates.length })]} />
      ) : null}

      <div className="flex items-center justify-between pt-1">
        <Button variant="ghost" onClick={onBack} disabled={busy}>
          {tw('nav.back')}
        </Button>
        <Button onClick={onFinish} disabled={busy}>
          {tw('nav.finish')}
        </Button>
      </div>
    </div>
  );
}

// ─── Shared step nav ────────────────────────────────────────────────────────────────────────

function StepNav({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  const tw = useTranslations('progress.scheduleWizard');
  return (
    <div className="flex items-center justify-between pt-1">
      <Button variant="ghost" onClick={onBack}>
        {tw('nav.back')}
      </Button>
      <Button onClick={onNext}>{nextLabel}</Button>
    </div>
  );
}
