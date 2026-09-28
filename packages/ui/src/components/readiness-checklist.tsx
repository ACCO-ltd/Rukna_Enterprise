'use client';

import * as React from 'react';
import { Check, LockKeyhole } from 'lucide-react';

import { cn } from '../lib/utils';
import { Badge } from './badge';

/**
 * A gate's checklist: "what is left before X can happen?"
 *
 * Built for project Start, deliberately generic — period close, contract activation and any
 * other guarded command have the same shape: a fixed sequence of steps, some required, some
 * optional, each either done, open, or waiting on another step.
 *
 * ─── What it decides, and what it leaves to the caller ───────────────────────────
 *
 * It owns the *reading order*: open steps first (in sequence), done steps folded into one
 * toggle row, a segmented bar with one segment per step in sequence order, and a summary
 * sentence computed from the step states. It does not decide what a step's action is or who
 * may take it — the caller passes a ready-made `action` node (usually a link button), or none.
 *
 * States are words and shapes, not only colour: a done step carries a check glyph, an optional
 * step a neutral "Optional" tag (a property, not a problem — never a warning tone), a waiting
 * step a dashed edge, a lock and "Waits for …". Only pass `waiting` when the source of truth
 * actually exposes the dependency; a guessed dependency is a rule the server does not enforce.
 */

export type ReadinessStepState = 'done' | 'open' | 'waiting';

export interface ReadinessStep {
  key: string;
  title: React.ReactNode;
  /** One sentence. Not shown on done rows. */
  description?: React.ReactNode;
  /** Who does this step — a role or team, not a person. */
  owner?: React.ReactNode;
  state: ReadinessStepState;
  /** The gate can be passed with this step open, with a recorded reason. */
  optional?: boolean;
  /** The step this one waits for. Only meaningful with `state: 'waiting'`. */
  waitingFor?: React.ReactNode;
  /** Already-formatted completion date for a done step, when the source has one. */
  doneAt?: React.ReactNode;
  /** Where the work lives. Done rows link their title here. */
  href?: string;
  /** The one control for an open step — usually a link button. Ignored on done/waiting steps. */
  action?: React.ReactNode;
}

export interface ReadinessChecklistLabels {
  /** "of 6" beside the big done count. */
  countOf: (total: number) => string;
  /** Screen-reader text for the progress bar: "5 of 6 steps done". */
  progress: (done: number, total: number) => string;
  summaryRequired: (requiredOpen: number) => string;
  summaryOptional: (optionalOpen: number) => string;
  summaryAllDone: string;
  optional: string;
  skippable: string;
  waitsFor: (step: React.ReactNode) => React.ReactNode;
  doneToggle: (done: number) => string;
  show: string;
  hide: string;
}

const DEFAULT_LABELS: ReadinessChecklistLabels = {
  countOf: (total) => `of ${total}`,
  progress: (done, total) => `${done} of ${total} steps done`,
  summaryRequired: (n) =>
    `${n} required ${n === 1 ? 'step' : 'steps'} left before you can start.`,
  summaryOptional: (n) => `Ready to start. ${n} optional ${n === 1 ? 'step is' : 'steps are'} still open.`,
  summaryAllDone: 'Ready to start. Every step is done.',
  optional: 'Optional',
  skippable: 'Can be skipped with a recorded reason',
  waitsFor: (step) => (
    <>
      Waits for <span className="font-medium text-foreground">{step}</span>
    </>
  ),
  doneToggle: (n) => `${n} ${n === 1 ? 'step' : 'steps'} done`,
  show: 'Show',
  hide: 'Hide',
};

export type ReadinessSummaryKind = 'required-open' | 'optional-open' | 'all-done';

export interface ReadinessCounts {
  total: number;
  done: number;
  requiredOpen: number;
  optionalOpen: number;
  kind: ReadinessSummaryKind;
}

/** Pure — what the summary sentence says. Waiting steps count as open. */
export function readinessCounts(steps: readonly Pick<ReadinessStep, 'state' | 'optional'>[]): ReadinessCounts {
  const done = steps.filter((s) => s.state === 'done').length;
  const open = steps.filter((s) => s.state !== 'done');
  const requiredOpen = open.filter((s) => !s.optional).length;
  const optionalOpen = open.length - requiredOpen;
  return {
    total: steps.length,
    done,
    requiredOpen,
    optionalOpen,
    kind: requiredOpen > 0 ? 'required-open' : optionalOpen > 0 ? 'optional-open' : 'all-done',
  };
}

type LinkComponent = React.ElementType<{
  href: string;
  className?: string;
  children?: React.ReactNode;
}>;

export interface ReadinessChecklistProps {
  title: React.ReactNode;
  steps: readonly ReadinessStep[];
  /** Overrides the computed summary sentence. */
  summary?: React.ReactNode;
  /** One sentence under the list — what passing the gate does. */
  footnote?: React.ReactNode;
  labels?: Partial<ReadinessChecklistLabels>;
  /** Id for the heading, so other controls can link or `aria-labelledby` to it. */
  headingId?: string;
  headingLevel?: 'h2' | 'h3';
  /** The router's link (e.g. Next's `Link`) for done-row titles. Defaults to `<a>`. */
  linkAs?: LinkComponent;
  className?: string;
}

export function ReadinessChecklist({
  title,
  steps,
  summary,
  footnote,
  labels: labelOverrides,
  headingId,
  headingLevel = 'h2',
  linkAs: LinkAs = 'a',
  className,
}: ReadinessChecklistProps) {
  const labels = { ...DEFAULT_LABELS, ...labelOverrides };
  const Heading = headingLevel;
  const generatedId = React.useId();
  const titleId = headingId ?? `${generatedId}-title`;
  const doneListId = `${generatedId}-done`;
  const [showDone, setShowDone] = React.useState(false);

  const counts = readinessCounts(steps);
  // Keep the sequence number with the step: it is the step's place in the gate, not its place
  // in whichever list it is currently drawn in.
  const numbered = steps.map((step, index) => ({ step, number: index + 1 }));
  const openSteps = numbered.filter(({ step }) => step.state !== 'done');
  const doneSteps = numbered.filter(({ step }) => step.state === 'done');

  const summaryText =
    summary ??
    (counts.kind === 'required-open'
      ? labels.summaryRequired(counts.requiredOpen)
      : counts.kind === 'optional-open'
        ? labels.summaryOptional(counts.optionalOpen)
        : labels.summaryAllDone);

  return (
    <section
      aria-labelledby={titleId}
      className={cn('min-w-0 rounded-panel border border-border bg-surface shadow-e1', className)}
    >
      <div className="px-4 pb-4 pt-4 sm:px-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <Heading id={titleId} className="text-h3 font-semibold text-foreground">
              {title}
            </Heading>
            <p className="mt-1 text-body-sm text-muted-foreground">{summaryText}</p>
          </div>
          <p className="shrink-0 text-body-sm text-muted-foreground" aria-hidden="true">
            <span className="text-h2 font-semibold tabular-nums text-foreground">{counts.done}</span>{' '}
            <span className="tabular-nums">{labels.countOf(counts.total)}</span>
          </p>
        </div>

        {/* One segment per step, in sequence order — the bar is a map of the gate, not a
            percentage. The text alternative carries the count; the segments are decoration. */}
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={counts.total}
          aria-valuenow={counts.done}
          aria-valuetext={labels.progress(counts.done, counts.total)}
          aria-label={labels.progress(counts.done, counts.total)}
          className="mt-3 flex gap-1"
        >
          {steps.map((step) => (
            <span
              key={step.key}
              data-state={step.state}
              data-optional={step.optional ? '' : undefined}
              className={cn(
                'h-1.5 min-w-0 flex-1 rounded-full',
                step.state === 'done'
                  ? 'bg-success'
                  : step.optional
                    ? 'border border-border-strong bg-transparent'
                    : 'bg-muted',
              )}
            />
          ))}
        </div>
      </div>

      {openSteps.length > 0 ? (
        <ol className="flex flex-col gap-2 px-4 pb-4 sm:px-5">
          {openSteps.map(({ step, number }) => (
            <OpenStepRow key={step.key} step={step} number={number} labels={labels} />
          ))}
        </ol>
      ) : null}

      {doneSteps.length > 0 ? (
        <div className="border-t border-border px-4 sm:px-5">
          <button
            type="button"
            aria-expanded={showDone}
            aria-controls={doneListId}
            onClick={() => setShowDone((value) => !value)}
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control text-start text-body-sm font-medium text-foreground focus-visible:outline-none focus-visible:shadow-ring"
          >
            <span className="flex items-center gap-2 text-body-sm">
              <CheckGlyph className="text-success" />
              {labels.doneToggle(doneSteps.length)}
            </span>
            <span className="text-caption font-medium text-brand-primary">
              {showDone ? labels.hide : labels.show}
            </span>
          </button>
          <ol id={doneListId} hidden={!showDone} className="pb-3">
            {doneSteps.map(({ step }) => (
              <li
                key={step.key}
                className="grid grid-cols-[1rem_minmax(0,1fr)_auto] items-baseline gap-x-2.5 border-t border-border py-2 min-[560px]:grid-cols-[1rem_minmax(0,1fr)_auto_auto]"
              >
                <CheckGlyph className="self-center text-success" />
                <span className="min-w-0 truncate text-body-sm text-foreground">
                  {step.href ? (
                    <LinkAs href={step.href} className="hover:underline">
                      {step.title}
                    </LinkAs>
                  ) : (
                    step.title
                  )}
                </span>
                {step.owner ? (
                  <span className="hidden text-caption text-muted-foreground min-[560px]:inline">
                    {step.owner}
                  </span>
                ) : (
                  <span className="hidden min-[560px]:inline" />
                )}
                <span className="text-caption tabular-nums text-muted-foreground">
                  {step.doneAt ?? null}
                </span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      {footnote ? (
        <div className="border-t border-border px-4 py-3 text-caption text-muted-foreground sm:px-5">
          {footnote}
        </div>
      ) : null}
    </section>
  );
}

function OpenStepRow({
  step,
  number,
  labels,
}: {
  step: ReadinessStep;
  number: number;
  labels: ReadinessChecklistLabels;
}) {
  const waiting = step.state === 'waiting';
  const meta = [
    step.owner,
    waiting && step.waitingFor ? labels.waitsFor(step.waitingFor) : null,
    !waiting && step.optional ? labels.skippable : null,
  ].filter(Boolean);

  return (
    <li
      data-state={step.state}
      className={cn(
        'flex flex-col gap-3 rounded-panel border p-3 min-[560px]:flex-row min-[560px]:items-center min-[560px]:justify-between sm:p-4',
        waiting ? 'border-dashed border-border bg-transparent' : 'border-border bg-surface-subtle',
      )}
    >
      <div className="flex min-w-0 gap-3">
        <span
          aria-hidden="true"
          className={cn(
            'mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-semibold tabular-nums',
            waiting
              ? 'border border-border text-muted-foreground'
              : 'bg-foreground text-background',
          )}
        >
          {waiting ? <LockGlyph /> : number}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p
              className={cn(
                'text-body-sm font-semibold',
                waiting ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {step.title}
            </p>
            {step.optional ? <Badge tone="neutral">{labels.optional}</Badge> : null}
          </div>
          {step.description ? (
            <p
              className={cn(
                'mt-0.5 text-body-sm',
                waiting ? 'text-muted-foreground' : 'text-foreground',
              )}
            >
              {step.description}
            </p>
          ) : null}
          {meta.length > 0 ? (
            <p className="mt-0.5 text-caption text-muted-foreground">
              {meta.map((item, index) => (
                <React.Fragment key={index}>
                  {index > 0 ? <span aria-hidden="true"> · </span> : null}
                  {item}
                </React.Fragment>
              ))}
            </p>
          ) : null}
        </div>
      </div>
      {!waiting && step.action ? (
        <div className="shrink-0 ps-9 min-[560px]:ps-0">{step.action}</div>
      ) : null}
    </li>
  );
}

function CheckGlyph({ className }: { className?: string }) {
  return <Check size={16} strokeWidth={2.5} className={cn('shrink-0', className)} aria-hidden="true" />;
}

function LockGlyph() {
  return <LockKeyhole size={12} aria-hidden="true" />;
}
