'use client';

import * as React from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@erp/ui';
import { Check, ChevronRight, Lock } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Where a step sits in an ordered setup flow.
 *
 * - `done`    — finished: check icon, title, one summary line, a trailing "Open ›" / "Edit ›".
 * - `current` — the one step to act on now: numbered, description, and a body that holds the
 *               view's single primary action. Optionally hideable.
 * - `todo`    — reachable but not the next thing to do (typically an optional step): numbered and
 *               collapsed; the reader may expand it.
 * - `locked`  — cannot start yet: dashed border, lock icon, "Waits for {x}." No body and no
 *               disabled buttons — a blocked step is explained in words, never greyed out.
 */
export type StepState = 'done' | 'current' | 'todo' | 'locked';

/** The trailing control on a `done` step. A link when it leaves the view, a toggle when it edits here. */
export type StepDoneAction =
  | { kind: 'open'; href: string; label?: string }
  | { kind: 'edit'; label?: string };

export interface StepSectionProps {
  /** 1-based position in the flow; shown in the circle for current / todo / locked steps. */
  step: number;
  state: StepState;
  /** Translated step title. */
  title: string;
  /** One line shown on a `done` step — what was set up, in figures the reader can check. */
  summary?: React.ReactNode;
  /** Shown on `current` (and on an expanded `todo`): what this step does and why. */
  description?: React.ReactNode;
  /** Marks the step optional with a quiet pill. */
  optional?: boolean;
  /** For `locked`: what the step is waiting for, completing the sentence "Waits for {x}." */
  waitsFor?: string;
  /** For `done`: where "Open ›" goes, or `edit` to expand the body in place ("Edit ›"). */
  doneAction?: StepDoneAction;
  /** For `current`: offer a "Hide" toggle that collapses the body. */
  hideable?: boolean;
  /**
   * Controlled open state of the body. Defaults: `current` open, everything else closed. A
   * `locked` step never shows a body, whatever this says.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** The step's body — for `current`, it must hold the view's one primary action. */
  children?: React.ReactNode;
  className?: string;
}

// ─── Indicator ────────────────────────────────────────────────────────────────

function StepIndicator({ step, state }: { step: number; state: StepState }) {
  const t = useTranslations('common.stepSection');

  if (state === 'done') {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success"
        aria-label={t('doneLabel')}
        role="img"
      >
        <Check size={14} aria-hidden="true" />
      </span>
    );
  }

  if (state === 'locked') {
    return (
      <span
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground"
        aria-label={t('lockedLabel')}
        role="img"
      >
        <Lock size={13} aria-hidden="true" />
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums',
        state === 'current'
          ? 'bg-brand-ink text-brand-on-primary'
          : 'border border-border bg-surface text-muted-foreground',
      )}
    >
      {step}
    </span>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * One step of an ordered setup flow (Progress › Plan & setup, and anything built like it).
 *
 * A stack of these reads top to bottom as "what's done, what's next, what's waiting": exactly one
 * step is `current` and carries the screen's one primary action; done steps collapse to a single
 * line; locked steps say what they wait for instead of showing controls that cannot be used.
 *
 * Unlike `ProgressStepper` (a horizontal wizard rail) the steps hold their own bodies, and unlike
 * `SetupChecklist` the order matters — a later step can be locked behind an earlier one.
 *
 * @example
 * <StepSection step={1} state="done" title="BOQ baselined"
 *   summary="Version 1 · 11 items" doneAction={{ kind: 'open', href: '/projects/p1/boq' }} />
 * <StepSection step={2} state="current" title="Work packages" description="…">
 *   <Button>Create delivery plan from BOQ</Button>
 * </StepSection>
 * <StepSection step={3} state="locked" title="Milestones" waitsFor="work packages" />
 */
export function StepSection({
  step,
  state,
  title,
  summary,
  description,
  optional,
  waitsFor,
  doneAction,
  hideable,
  open: openProp,
  onOpenChange,
  children,
  className,
}: StepSectionProps) {
  const t = useTranslations('common.stepSection');
  const headingId = React.useId();
  const bodyId = React.useId();

  const [openState, setOpenState] = React.useState(state === 'current');
  // A step that becomes current (the previous one just finished) opens itself; one that stops
  // being current closes. Keyed on the state, so the reader's own toggling is otherwise kept.
  const [lastState, setLastState] = React.useState(state);
  if (lastState !== state) {
    setLastState(state);
    setOpenState(state === 'current');
  }

  const isControlled = openProp !== undefined;
  const open = state !== 'locked' && (isControlled ? openProp : openState);
  const setOpen = (next: boolean) => {
    if (!isControlled) setOpenState(next);
    onOpenChange?.(next);
  };

  const hasBody = Boolean(children) && state !== 'locked';

  // The trailing control on the header row.
  let trailing: React.ReactNode = null;
  if (state === 'done' && doneAction?.kind === 'open') {
    trailing = (
      <Link
        href={doneAction.href}
        className="inline-flex min-h-11 items-center gap-0.5 rounded-control px-2 text-body-sm font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:shadow-ring"
      >
        {doneAction.label ?? t('open')}
        <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />
      </Link>
    );
  } else if (state === 'done' && doneAction?.kind === 'edit' && hasBody) {
    trailing = (
      <ToggleButton open={open} controls={bodyId} onClick={() => setOpen(!open)}>
        {open ? t('hide') : (doneAction.label ?? t('edit'))}
        {open ? null : <ChevronRight size={14} className="rtl:rotate-180" aria-hidden="true" />}
      </ToggleButton>
    );
  } else if (state === 'todo' && hasBody) {
    trailing = (
      <ToggleButton open={open} controls={bodyId} onClick={() => setOpen(!open)}>
        {open ? t('hide') : t('show')}
      </ToggleButton>
    );
  } else if (state === 'current' && hideable && hasBody) {
    trailing = (
      <ToggleButton open={open} controls={bodyId} onClick={() => setOpen(!open)}>
        {open ? t('hide') : t('show')}
      </ToggleButton>
    );
  }

  const muted = state === 'locked' || state === 'todo';

  return (
    <section
      aria-labelledby={headingId}
      aria-current={state === 'current' ? 'step' : undefined}
      data-state={state}
      className={cn(
        'rounded-panel border bg-surface',
        state === 'locked' ? 'border-dashed border-border bg-transparent' : 'border-border',
        state === 'current' ? 'shadow-e1' : undefined,
        className,
      )}
    >
      <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
        <div className="pt-0.5">
          <StepIndicator step={step} state={state} />
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              id={headingId}
              className={cn(
                'text-body font-semibold',
                muted ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {title}
            </h3>
            {optional ? (
              <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-micro font-medium text-muted-foreground">
                {t('optional')}
              </span>
            ) : null}
          </div>

          {state === 'done' && summary ? (
            <p className="mt-0.5 text-body-sm text-muted-foreground">{summary}</p>
          ) : null}

          {state === 'locked' && waitsFor ? (
            <p className="mt-0.5 text-body-sm text-muted-foreground">
              {t('waitsFor', { what: waitsFor })}
            </p>
          ) : null}

          {(state === 'current' || (state === 'todo' && open)) && description ? (
            <p className="mt-0.5 max-w-prose text-body-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {trailing ? <div className="shrink-0">{trailing}</div> : null}
      </div>

      {hasBody && open ? (
        <div id={bodyId} className="border-t border-border px-4 py-4 sm:px-5">
          {children}
        </div>
      ) : null}
    </section>
  );
}

function ToggleButton({
  open,
  controls,
  onClick,
  children,
}: {
  open: boolean;
  controls: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={open ? controls : undefined}
      onClick={onClick}
      className="inline-flex min-h-11 items-center gap-0.5 rounded-control px-2 text-body-sm font-medium text-brand-primary hover:underline focus-visible:outline-none focus-visible:shadow-ring"
    >
      {children}
    </button>
  );
}
