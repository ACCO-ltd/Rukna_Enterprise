import * as React from 'react';
import { Check, Ellipsis } from 'lucide-react';

import { cn } from '../lib/utils';
import { DefinitionGrid, type DefinitionFact } from './document-body';
import { Button } from './button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './dropdown-menu';

// ─── Lifecycle stepper ────────────────────────────────────────────────────────

export interface LifecycleStep {
  key: string;
  label: string;
}

export interface LifecycleStepperProps {
  /** The document type's real state machine, in order — never a generic one. */
  steps: LifecycleStep[];
  /** Key of the current step. Earlier steps render done, later ones pending. */
  current: string;
  /**
   * A terminal state off the main line (Reversed, Rejected, Cancelled): appended after the
   * steps, current, in its own tone. Every main step is shown done or reached before it.
   */
  terminal?: { label: string; tone: 'historical' | 'danger' };
  /** "step {n} of {total}" for the one-line phone form. */
  stepOfLabel?: (n: number, total: number) => string;
  className?: string;
}

const TERMINAL_TEXT = { historical: 'text-historical', danger: 'text-danger' } as const;
const TERMINAL_RING = { historical: 'border-historical', danger: 'border-danger' } as const;

/**
 * Where a document is in its lifecycle — read-only (ADR-035). It never takes a click: moving a
 * document on is a governed command in the action bar, not a toggle. Below `sm` it collapses
 * to one line, "Approved · step 3 of 4".
 */
export function LifecycleStepper({
  steps,
  current,
  terminal,
  stepOfLabel = (n, total) => `step ${n} of ${total}`,
  className,
}: LifecycleStepperProps) {
  const index = Math.max(0, steps.findIndex((step) => step.key === current));
  const all = terminal ? steps.length + 1 : steps.length;
  const position = terminal ? all : index + 1;
  const currentLabel = terminal ? terminal.label : steps[index]?.label;

  return (
    <div className={className}>
      <p className="text-body-sm sm:hidden">
        <span className="font-semibold text-foreground">{currentLabel}</span>
        <span className="text-muted-foreground"> · {stepOfLabel(position, all)}</span>
      </p>
      <ol className="hidden items-center gap-2 sm:flex" aria-label={currentLabel}>
        {steps.map((step, i) => {
          const done = terminal ? true : i < index;
          const isCurrent = !terminal && i === index;
          return (
            <li key={step.key} className="flex items-center gap-2">
              {i > 0 ? <span aria-hidden="true" className="h-px w-6 bg-border-strong" /> : null}
              <span
                aria-current={isCurrent ? 'step' : undefined}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm',
                  done || isCurrent ? 'font-medium text-foreground' : 'text-muted-foreground',
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex size-4 items-center justify-center rounded-full border',
                    done && 'border-foreground bg-foreground text-background',
                    isCurrent && 'border-foreground',
                    !done && !isCurrent && 'border-border-strong',
                  )}
                >
                  {done ? <Check size={10} strokeWidth={3} /> : null}
                  {isCurrent ? <span className="size-2 rounded-full bg-foreground" /> : null}
                </span>
                {step.label}
              </span>
            </li>
          );
        })}
        {terminal ? (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-px w-6 bg-border-strong" />
            <span
              aria-current="step"
              className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-body-sm font-medium', TERMINAL_TEXT[terminal.tone])}
            >
              <span
                aria-hidden="true"
                className={cn('flex size-4 items-center justify-center rounded-full border', TERMINAL_RING[terminal.tone])}
              >
                <span className="size-2 rounded-full bg-current" />
              </span>
              {terminal.label}
            </span>
          </li>
        ) : null}
      </ol>
    </div>
  );
}

// ─── Action bar ───────────────────────────────────────────────────────────────

export interface DocumentCommand {
  key: string;
  label: string;
  onSelect: () => void;
  /** Destructive commands sit last in the menu, in danger. */
  destructive?: boolean;
}

export interface DocumentActionBarProps {
  /** The back link — a `Link` to the list, rendered by the caller. */
  back?: React.ReactNode;
  /** The one primary command valid for this state, or nothing (a terminal state has none). */
  primary?: React.ReactNode;
  /** Secondary commands, in a kebab. Only commands the viewer can run — never disabled ones. */
  commands?: DocumentCommand[];
  /** Accessible name for the kebab trigger. */
  moreLabel?: string;
  /** Usually a `LifecycleStepper`. */
  lifecycle?: React.ReactNode;
  className?: string;
}

/**
 * The sticky bar at the top of every document (ADR-035): back link, the one primary command for
 * this state, secondary commands in a kebab, and the read-only lifecycle on the right. Commands
 * come from backend state and permissions — an unavailable command is not rendered at all, and
 * a blocked one is explained in words by a `Notice`, not by a greyed-out button.
 */
export function DocumentActionBar({
  back,
  primary,
  commands = [],
  moreLabel = 'More actions',
  lifecycle,
  className,
}: DocumentActionBarProps) {
  const safe = commands.filter((c) => !c.destructive);
  const destructive = commands.filter((c) => c.destructive);

  return (
    <div
      className={cn(
        'sticky top-14 z-20 -mx-4 mb-6 flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-panel sm:border sm:bg-surface sm:px-4',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
        {back}
        {primary}
        {commands.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label={moreLabel}>
                <Ellipsis size={16} aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-48">
              {safe.map((command) => (
                <DropdownMenuItem key={command.key} onSelect={command.onSelect}>
                  {command.label}
                </DropdownMenuItem>
              ))}
              {safe.length > 0 && destructive.length > 0 ? <DropdownMenuSeparator /> : null}
              {destructive.map((command) => (
                <DropdownMenuItem
                  key={command.key}
                  onSelect={command.onSelect}
                  className="text-danger focus:text-danger"
                >
                  {command.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {lifecycle ? <div className="w-full sm:w-auto">{lifecycle}</div> : null}
    </div>
  );
}

// ─── Identity ─────────────────────────────────────────────────────────────────

export interface DocumentAxis {
  /** "Document", "Posting", "Match". */
  label: string;
  /** A `StatusPill` for the document axis; `StatusText` for the others. */
  value: React.ReactNode;
}

export interface DocumentIdentityProps {
  /** The document type — "Supplier bill". */
  eyebrow: string;
  /** The document number, or the status word before a number is issued. */
  title: React.ReactNode;
  /** One line under the title — the counterparty, usually. */
  subtitle?: React.ReactNode;
  /** Status axes, each labelled — never three unlabelled pills in a row. */
  axes?: DocumentAxis[];
  /** The document's facts, as a two-column definition grid under the axes. */
  facts?: DefinitionFact[];
  /** Heading level. The module header owns the page's `h1`, so this defaults to `h2`. */
  as?: 'h1' | 'h2';
  className?: string;
}

/**
 * Who the document is: type eyebrow, the number as the page's visual anchor, and its status
 * axes labelled Document / Posting / Match.
 */
export function DocumentIdentity({
  eyebrow,
  title,
  subtitle,
  axes = [],
  facts = [],
  as: Heading = 'h2',
  className,
}: DocumentIdentityProps) {
  return (
    <div className={cn('mb-6', className)}>
      <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">
        {eyebrow}
      </p>
      <Heading className="mt-1 text-display font-semibold tracking-tight text-foreground">
        {title}
      </Heading>
      {subtitle ? <p className="mt-1 text-body text-muted-foreground">{subtitle}</p> : null}
      {axes.length > 0 ? (
        <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          {axes.map((axis) => (
            <div key={axis.label} className="flex items-center gap-2">
              <dt className="text-caption text-muted-foreground">{axis.label}</dt>
              <dd>{axis.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {facts.length > 0 ? <DefinitionGrid facts={facts} className="mt-5" /> : null}
    </div>
  );
}
