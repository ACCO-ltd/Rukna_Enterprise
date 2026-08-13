'use client';

import * as React from 'react';

import { cn } from '../lib/utils';
import { LtrValue } from './ltr-value';

/**
 * Approval presentation: the chain, its history, and the decision.
 *
 * ─── Why this is the most valuable component in the system ───────────────────────
 *
 * The platform's whole backend proposition is a governed approval chain with delegation-of-
 * authority thresholds. The UI had one hand-built panel, in one module. Material requests,
 * purchase orders, supplier bills, payments, journals, certificates, contracts and
 * variations all route for approval and all deserve to look like the same mechanism,
 * because to the person approving them it *is* the same mechanism.
 *
 * ─── Three parts, always together ────────────────────────────────────────────────
 *
 *   ApprovalChain      across the top: where the document is and who is next
 *   ApprovalTimeline   in the rail: who did what, when, and what they said
 *   DecisionPanel      where the current approver acts
 *
 * ─── The rule that keeps an approval from feeling arbitrary ───────────────────────
 *
 * **Steps that have not been reached are still shown, with the reason they exist.** A chain
 * that renders only as far as the current step tells an approver nothing about what happens
 * after them, and a step that appears from nowhere at 5,000,001 SOS reads as the system
 * making it up. `condition` is where "Required above 5 000 000 SOS" goes, and it is worth
 * more than the step's own label.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalState =
  /** Acted on, moved forward. */
  | 'approved'
  /** Acted on, stopped the document. */
  | 'rejected'
  /** Acted on, sent back for changes. */
  | 'returned'
  /** Waiting on this step now. */
  | 'current'
  /** Not yet reached. */
  | 'upcoming'
  /** Not required for this document — under a threshold, or delegated away. */
  | 'skipped';

export interface ApprovalStep {
  id: string;
  /** The role that acts, not the person — "Finance manager". Already translated. */
  title: string;
  /** Who holds it, when known. */
  actor?: string;
  /** Formatted by the caller: packages/ui does not know the locale. */
  at?: string;
  state: ApprovalState;
  /**
   * Why this step is in the chain — "Required above 5 000 000 SOS".
   *
   * Most valuable on `upcoming` and `skipped` steps, which are otherwise unexplained.
   */
  condition?: string;
  /** What the approver wrote. Shown in the timeline, not the chain. */
  comment?: string;
  /** Marks the step the signed-in user is being asked to act on. */
  isYou?: boolean;
}

// ─── Shared visual vocabulary ─────────────────────────────────────────────────

/**
 * One state → one node treatment, used by both the chain and the timeline so the same step
 * is recognisably the same step in either place.
 */
function nodeClasses(state: ApprovalState): string {
  switch (state) {
    case 'approved':
      return 'bg-success text-white border-success';
    case 'rejected':
      return 'bg-danger text-danger-foreground border-danger';
    case 'returned':
      return 'bg-warning text-white border-warning';
    case 'current':
      return 'bg-brand-primary text-brand-on-primary border-brand-primary';
    case 'skipped':
      return 'bg-muted text-muted-foreground border-border';
    default:
      return 'bg-surface text-muted-foreground border-border-strong';
  }
}

function StateGlyph({ state, index }: { state: ApprovalState; index: number }) {
  if (state === 'approved') {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 6.4l2.6 2.6L10 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === 'rejected') {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3.4 3.4l5.2 5.2M8.6 3.4L3.4 8.6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === 'returned') {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M9 6H4.2M6 3.6L3.6 6l2.4 2.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === 'skipped') {
    return (
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M3 6h6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    );
  }
  // current and upcoming both carry their position, which is the thing an approver counts.
  return <span className="font-mono text-micro font-bold tabular-nums">{index + 1}</span>;
}

/** Connector tone: the path already walked is green, the rest is inert. */
function connectorClass(state: ApprovalState): string {
  if (state === 'approved') return 'bg-success/40';
  if (state === 'rejected') return 'bg-danger/40';
  if (state === 'returned') return 'bg-warning/40';
  return 'bg-border-strong/60';
}

// ─── Chain ────────────────────────────────────────────────────────────────────

export interface ApprovalChainProps {
  steps: ApprovalStep[];
  /** Already-translated accessible name — e.g. "Approval chain". */
  label: string;
  /** Rendered on the step where `isYou` is true — e.g. a Badge saying "Awaiting you". */
  awaitingYouSlot?: React.ReactNode;
  className?: string;
}

export function ApprovalChain({ steps, label, awaitingYouSlot, className }: ApprovalChainProps) {
  return (
    <nav
      aria-label={label}
      className={cn('overflow-x-auto [-webkit-overflow-scrolling:touch]', className)}
    >
      {/* An ordered list, because the order is the information. */}
      <ol className="flex min-w-max items-start">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="flex items-start">
              <div className="w-32 shrink-0">
                <div className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                      nodeClasses(step.state),
                      step.state === 'current' && 'ring-4 ring-brand-accent',
                    )}
                  >
                    <StateGlyph state={step.state} index={index} />
                  </span>
                  <span
                    className={cn(
                      'min-w-0 text-caption font-semibold leading-tight',
                      step.state === 'upcoming' || step.state === 'skipped'
                        ? 'text-muted-foreground'
                        : 'text-foreground',
                    )}
                  >
                    {step.title}
                  </span>
                </div>

                <div className="mt-1.5 ps-8">
                  {step.actor ? (
                    <span className="block text-micro normal-case tracking-normal text-muted-foreground">
                      {step.actor}
                    </span>
                  ) : null}
                  {step.at ? (
                    <LtrValue className="mt-0.5 block font-mono text-micro tracking-normal text-muted-foreground">
                      {step.at}
                    </LtrValue>
                  ) : null}
                  {/* The reason an unreached step exists. Without this a chain reads as
                      arbitrary the moment a threshold adds a step. */}
                  {step.condition ? (
                    <span className="mt-1 block text-micro normal-case leading-4 tracking-normal text-muted-foreground">
                      {step.condition}
                    </span>
                  ) : null}
                  {step.isYou && awaitingYouSlot ? (
                    <span className="mt-1.5 block">{awaitingYouSlot}</span>
                  ) : null}
                </div>
              </div>

              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={cn('mt-3 h-px w-8 shrink-0', connectorClass(step.state))}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

export interface ApprovalTimelineProps {
  steps: ApprovalStep[];
  /** Already-translated accessible name — e.g. "Approval history". */
  label: string;
  /** Shown under a step that has not been reached — e.g. "Not yet reached". */
  upcomingLabel?: string;
  className?: string;
}

export function ApprovalTimeline({
  steps,
  label,
  upcomingLabel,
  className,
}: ApprovalTimelineProps) {
  return (
    <ol aria-label={label} className={cn('flex flex-col', className)}>
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const muted = step.state === 'upcoming' || step.state === 'skipped';
        return (
          <li key={step.id} className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-3">
            <div className="flex flex-col items-center">
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                  nodeClasses(step.state),
                )}
              >
                <StateGlyph state={step.state} index={index} />
              </span>
              {/* The stem is what makes a list of rows read as a sequence. */}
              {!isLast ? (
                <span aria-hidden="true" className="my-1 w-px flex-1 bg-border" style={{ minHeight: '0.75rem' }} />
              ) : null}
            </div>

            <div className={cn('min-w-0', !isLast && 'pb-4')}>
              <p className={cn('text-body-sm font-semibold', muted ? 'text-muted-foreground' : 'text-foreground')}>
                {step.title}
              </p>
              {step.actor ? (
                <p className="mt-0.5 text-caption text-muted-foreground">{step.actor}</p>
              ) : null}
              {step.at ? (
                <LtrValue as="p" className="mt-0.5 font-mono text-micro tracking-normal text-muted-foreground">
                  {step.at}
                </LtrValue>
              ) : null}
              {muted && upcomingLabel && !step.at ? (
                <p className="mt-0.5 text-caption text-muted-foreground">{upcomingLabel}</p>
              ) : null}
              {step.condition ? (
                <p className="mt-0.5 text-caption leading-5 text-muted-foreground">{step.condition}</p>
              ) : null}
              {/* Quoted, and kept: why a document was returned is the most re-read text on
                  the record, and it is what the next approver needs before deciding. */}
              {step.comment ? (
                <p className="mt-1.5 border-s-2 border-border ps-2.5 text-caption leading-5 text-brand-ink-soft">
                  {step.comment}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ─── Decision panel ───────────────────────────────────────────────────────────

export type ApprovalDecision = 'approve' | 'return' | 'reject';

export interface DecisionPanelProps {
  /**
   * Called with the decision and the comment. The comment is guaranteed non-empty for
   * `return` and `reject`; the panel will not submit those without one.
   */
  onDecide: (decision: ApprovalDecision, comment: string) => void;
  /** Disables everything while a decision is in flight. */
  busy?: boolean;
  /** Already-translated labels. */
  labels: {
    commentLabel: string;
    /** e.g. "required to return or reject" */
    commentNote: string;
    commentPlaceholder: string;
    approve: string;
    return: string;
    reject: string;
    /** Shown when return or reject is attempted with an empty comment. */
    commentRequired: string;
  };
  /** Summary rows above the controls — what the approver is deciding about. */
  children?: React.ReactNode;
  className?: string;
}

export function DecisionPanel({
  onDecide,
  busy,
  labels,
  children,
  className,
}: DecisionPanelProps) {
  const [comment, setComment] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const commentId = React.useId();
  const errorId = `${commentId}-error`;

  /**
   * Approving needs no explanation — the decision is the record. Returning or rejecting
   * always does: the person on the other end has to know what to change, and a bare
   * "rejected" turns into a phone call. Enforced here rather than left to each caller,
   * because it is the same rule for every document type.
   */
  const submit = (decision: ApprovalDecision) => {
    const trimmed = comment.trim();
    if (decision !== 'approve' && trimmed.length === 0) {
      setError(labels.commentRequired);
      return;
    }
    setError(null);
    onDecide(decision, trimmed);
  };

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {children}

      <div>
        <label htmlFor={commentId} className="block text-caption font-semibold text-foreground">
          {labels.commentLabel}
          <span className="ms-1.5 font-normal text-muted-foreground">{labels.commentNote}</span>
        </label>
        <textarea
          id={commentId}
          rows={3}
          value={comment}
          disabled={busy}
          onChange={(event) => {
            setComment(event.target.value);
            if (error) setError(null);
          }}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          placeholder={labels.commentPlaceholder}
          className={cn(
            'mt-1.5 flex min-h-20 w-full resize-y rounded-control border bg-surface px-3.5 py-2.5 text-sm leading-6 text-foreground shadow-e1 placeholder:text-muted-foreground',
            'transition-[border-color,box-shadow] duration-(--motion-enter) ease-brand',
            'hover:border-border-interactive focus:border-brand-primary focus:outline-none focus:shadow-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            error ? 'border-danger' : 'border-border-strong',
          )}
        />
        {error ? (
          <p id={errorId} role="alert" className="mt-1.5 text-caption font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap gap-2">
        {/* Approve first and visually dominant: it is the outcome in the overwhelming
            majority of cases, and burying it beside two equal-weight buttons makes the
            common path as slow as the rare one. */}
        <button
          type="button"
          disabled={busy}
          onClick={() => submit('approve')}
          className="inline-flex h-control items-center justify-center rounded-control border border-brand-primary bg-brand-primary px-4 text-body-sm font-semibold text-brand-on-primary shadow-e1 transition-colors duration-(--motion-enter) ease-brand hover:bg-brand-primary-hover focus-visible:outline-none focus-visible:shadow-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.approve}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit('return')}
          className="inline-flex h-control items-center justify-center rounded-control border border-border-strong bg-surface px-4 text-body-sm font-semibold text-foreground shadow-e1 transition-colors duration-(--motion-enter) ease-brand hover:border-border-interactive hover:bg-surface-hover focus-visible:outline-none focus-visible:shadow-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.return}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit('reject')}
          className="inline-flex h-control items-center justify-center rounded-control border border-danger/40 bg-surface px-4 text-body-sm font-semibold text-danger transition-colors duration-(--motion-enter) ease-brand hover:bg-danger-subtle focus-visible:outline-none focus-visible:shadow-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {labels.reject}
        </button>
      </div>
    </div>
  );
}

// ─── Not configured ───────────────────────────────────────────────────────────

/**
 * What a `422` looks like.
 *
 * The API returns 422 when a document needs an approval workflow that nobody has configured.
 * That is not a failure of the user's action and it must not surface as a toast that
 * disappears — it is a statement about this document's state, so it renders where the chain
 * would have been. The person reading it cannot fix it, so it says who can.
 */
export function ApprovalNotConfigured({
  title,
  description,
  className,
}: {
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex gap-3 rounded-panel border border-dashed border-warning/40 bg-warning-subtle px-4 py-3.5',
        className,
      )}
    >
      <span className="mt-0.5 shrink-0 text-warning">
        <svg width="16" height="16" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M6 1.4l4.9 8.5H1.1L6 1.4z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
          <path d="M6 5v2.1M6 8.6v.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
      <div className="min-w-0">
        <p className="text-body-sm font-semibold text-warning">{title}</p>
        <p className="mt-0.5 text-caption leading-5 text-warning">{description}</p>
      </div>
    </div>
  );
}
