'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * A guided, gated sequence.
 *
 * ─── Why a shell ─────────────────────────────────────────────────────────────────
 *
 * Three flows in this product are already stepped — the IPC wizard, the opening-balance
 * migration, and the New Project form — and each built its own step state, its own gate,
 * its own idea of what "back" means. Three implementations of one machine is three places a
 * gate can be wrong, and on a certificate flow a gate being wrong costs money.
 *
 * ─── What the shell owns, and what it deliberately does not ──────────────────────
 *
 * Owns: which step is current, which are complete, whether leaving a step is allowed, the
 * confirmed-summary rows, the review step, and the terminal success screen.
 *
 * Does **not** own the form data, and does not persist anything. That is not an omission:
 * `apps/web/CLAUDE.md` forbids caching sensitive financial data in `localStorage` or
 * `sessionStorage`, and the existing IPC wizard persists certified quantities and deductions
 * to `sessionStorage` today. A shell that offered draft persistence would make that
 * violation the default for every future flow. Data stays with the caller's form library,
 * where it already is.
 *
 * ─── The behaviour that makes a long flow feel effortless ────────────────────────
 *
 * A completed step collapses into a labelled row carrying the values it captured, and stays
 * on screen. The user can always see what they have committed to and can return to exactly
 * one thing without unwinding the rest. That — not the row of dots — is what the reference
 * flows this was drawn from actually do.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WizardStep<TId extends string = string> {
  id: TId;
  /** Already-translated step name. */
  label: string;
  /**
   * Gate. Return false (or a rejected/false promise) to keep the user on this step —
   * the caller shows its own field errors; the shell only decides whether to move.
   *
   * Omit for a step that cannot be invalid.
   */
  validate?: () => boolean | Promise<boolean>;
  /**
   * What this step captured, rendered in its collapsed row once complete.
   * Keep it to one line: "18 lines certified · gross 486 200.00 SOS".
   */
  summary?: () => React.ReactNode;
  /** The step's own fields. */
  render: () => React.ReactNode;
}

export type WizardStatus = 'pending' | 'complete' | 'current' | 'upcoming';

// ─── Hook ─────────────────────────────────────────────────────────────────────

export interface UseWizardResult<TId extends string> {
  currentId: TId;
  currentIndex: number;
  isFirst: boolean;
  isLast: boolean;
  /** True while an async `validate` is running. */
  validating: boolean;
  completed: ReadonlySet<TId>;
  statusOf: (id: TId) => WizardStatus;
  next: () => Promise<void>;
  back: () => void;
  /** Jump to a step. Refused for steps that are neither complete nor current. */
  goTo: (id: TId) => void;
}

export function useWizard<TId extends string>(
  steps: readonly WizardStep<TId>[],
  options?: { onComplete?: () => void },
): UseWizardResult<TId> {
  const [index, setIndex] = React.useState(0);
  const [completed, setCompleted] = React.useState<Set<TId>>(new Set());
  const [validating, setValidating] = React.useState(false);

  const current = steps[index];
  const isLast = index === steps.length - 1;

  const next = React.useCallback(async () => {
    if (!current) return;
    let ok = true;
    if (current.validate) {
      setValidating(true);
      try {
        ok = await current.validate();
      } catch {
        // A gate that throws is a gate that failed. Swallowing the error and staying put is
        // right: the caller surfaces the reason, and advancing on an exception is how an
        // invalid certificate gets submitted.
        ok = false;
      } finally {
        setValidating(false);
      }
    }
    if (!ok) return;

    setCompleted((prev) => new Set(prev).add(current.id));
    if (isLast) options?.onComplete?.();
    else setIndex((i) => Math.min(i + 1, steps.length - 1));
  }, [current, isLast, options, steps.length]);

  const back = React.useCallback(() => {
    setIndex((i) => Math.max(i - 1, 0));
  }, []);

  const goTo = React.useCallback(
    (id: TId) => {
      const target = steps.findIndex((s) => s.id === id);
      if (target < 0) return;
      // Forward jumps are refused: reaching step 4 without passing step 2's gate is exactly
      // what the gate exists to prevent, and "the tab was clickable" is not a defence.
      if (target > index && !completed.has(id)) return;
      setIndex(target);
    },
    [completed, index, steps],
  );

  const statusOf = React.useCallback(
    (id: TId): WizardStatus => {
      const at = steps.findIndex((s) => s.id === id);
      if (at === index) return 'current';
      if (completed.has(id)) return 'complete';
      return at < index ? 'pending' : 'upcoming';
    },
    [completed, index, steps],
  );

  return {
    currentId: (current?.id ?? steps[0]?.id) as TId,
    currentIndex: index,
    isFirst: index === 0,
    isLast,
    validating,
    completed,
    statusOf,
    next,
    back,
    goTo,
  };
}

// ─── Rail ─────────────────────────────────────────────────────────────────────

export function WizardRail<TId extends string>({
  steps,
  wizard,
  label,
  onNavigate,
  className,
}: {
  steps: readonly WizardStep<TId>[];
  wizard: UseWizardResult<TId>;
  /** Already-translated accessible name — e.g. "Progress". */
  label: string;
  /** Omit to make the rail purely indicative. */
  onNavigate?: (id: TId) => void;
  className?: string;
}) {
  return (
    <nav aria-label={label} className={cn('overflow-x-auto [-webkit-overflow-scrolling:touch]', className)}>
      <ol className="flex min-w-max items-center">
        {steps.map((step, index) => {
          const status = wizard.statusOf(step.id);
          const isLast = index === steps.length - 1;
          // Only completed steps are reachable; the current one is already here.
          const reachable = Boolean(onNavigate) && status === 'complete';

          const dot = (
            <span
              aria-hidden="true"
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border',
                status === 'complete'
                  ? 'border-success bg-success text-white'
                  : status === 'current'
                    ? 'border-brand-primary bg-brand-primary text-brand-on-primary ring-4 ring-brand-accent'
                    : 'border-border-strong bg-surface text-muted-foreground',
              )}
            >
              {status === 'complete' ? (
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                  <path d="M2 6.4l2.6 2.6L10 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <span className="font-mono text-micro font-bold tabular-nums">{index + 1}</span>
              )}
            </span>
          );

          const text = (
            <span
              className={cn(
                'whitespace-nowrap text-caption font-semibold',
                status === 'current'
                  ? 'text-brand-primary'
                  : status === 'complete'
                    ? 'text-foreground'
                    : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
          );

          return (
            <li key={step.id} className="flex items-center">
              {reachable ? (
                <button
                  type="button"
                  onClick={() => onNavigate?.(step.id)}
                  className="flex items-center gap-2 rounded-control px-1 py-0.5 focus-visible:outline-none focus-visible:shadow-ring"
                >
                  {dot}
                  {text}
                </button>
              ) : (
                <span
                  className="flex items-center gap-2 px-1 py-0.5"
                  aria-current={status === 'current' ? 'step' : undefined}
                >
                  {dot}
                  {text}
                </span>
              )}
              {!isLast ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    'mx-3 h-px w-10 shrink-0',
                    status === 'complete' ? 'bg-success/40' : 'bg-border-strong/60',
                  )}
                />
              ) : null}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

// ─── Confirmed summary row ────────────────────────────────────────────────────

/**
 * A completed step, collapsed.
 *
 * This is the component that makes the pattern work. It stays on screen for every step the
 * user has passed, so what they committed to is never more than a glance away, and Change
 * returns to exactly one step rather than restarting the flow.
 */
export function WizardSummaryRow({
  label,
  value,
  onChange,
  changeLabel,
  className,
}: {
  label: string;
  value: React.ReactNode;
  onChange?: () => void;
  /** Already-translated — e.g. "Change". */
  changeLabel?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-control border border-border bg-surface px-3.5 py-2.5',
        className,
      )}
    >
      <span className="w-28 shrink-0 text-caption text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 text-body-sm font-medium text-foreground">{value}</span>
      <span aria-hidden="true" className="shrink-0 text-success">
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.4l2.6 2.6L10 3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      {onChange && changeLabel ? (
        <button
          type="button"
          onClick={onChange}
          className="shrink-0 rounded-control px-1 text-caption font-semibold text-brand-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-ring"
        >
          {changeLabel}
        </button>
      ) : null}
    </div>
  );
}

// ─── Step panel ───────────────────────────────────────────────────────────────

export function WizardStepPanel({
  stepLabel,
  title,
  description,
  children,
  footer,
  className,
}: {
  /** e.g. "Step 3 of 4", already translated and interpolated. */
  stepLabel: string;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        'rounded-panel border border-brand-primary/30 bg-surface p-5 shadow-e1',
        className,
      )}
    >
      <p className="text-micro font-semibold uppercase text-brand-primary">{stepLabel}</p>
      <h2 className="mt-1 text-h2 font-semibold text-foreground">{title}</h2>
      {description ? (
        <p className="mt-1.5 max-w-[60ch] text-body-sm text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
      {footer ? <div className="mt-5 flex flex-wrap items-center gap-2">{footer}</div> : null}
    </section>
  );
}

// ─── Success ──────────────────────────────────────────────────────────────────

/**
 * The terminal screen.
 *
 * Worth having as a component rather than a redirect: a flow that ends by silently landing
 * somewhere else leaves the user unsure whether it worked. This states what happened, gives
 * the reference they will need to quote, and offers the two things they are likely to do
 * next.
 */
export function WizardSuccess({
  title,
  description,
  reference,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  /** The identifier the flow produced — IPC-2026-0042. Mono, selectable. */
  reference?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      role="status"
      className={cn(
        'flex flex-col items-center gap-3 rounded-panel border border-success/25 bg-success-subtle px-6 py-10 text-center',
        className,
      )}
    >
      <span aria-hidden="true" className="flex h-11 w-11 items-center justify-center rounded-full bg-success text-white">
        <svg width="20" height="20" viewBox="0 0 12 12" fill="none">
          <path d="M2 6.4l2.6 2.6L10 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <h2 className="text-h2 font-semibold text-foreground">{title}</h2>
      {reference ? (
        <code className="rounded-control border border-success/25 bg-surface px-2.5 py-1 font-mono text-body-sm text-foreground">
          {reference}
        </code>
      ) : null}
      {description ? (
        <p className="max-w-[52ch] text-body-sm text-brand-ink-soft">{description}</p>
      ) : null}
      {actions ? <div className="mt-1 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </section>
  );
}
