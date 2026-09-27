import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import { Lock } from 'lucide-react';

import { cn } from '../lib/utils';
import { initialsFromName } from './avatar';

// ─── Definition grid ──────────────────────────────────────────────────────────

export interface DefinitionFact {
  label: string;
  /** Plain text, or a `Link` for a source document (the PO, the GRN, the project). */
  value: React.ReactNode;
}

/**
 * A document's facts as label/value rows in two columns, stacking to one below `sm`
 * (ADR-036). Source documents are links, so the reader can walk from a bill to its PO.
 */
export function DefinitionGrid({ facts, className }: { facts: DefinitionFact[]; className?: string }) {
  if (facts.length === 0) return null;
  return (
    <dl className={cn('grid gap-x-10 sm:grid-cols-2', className)}>
      {facts.map((fact) => (
        <div
          key={fact.label}
          className="grid min-w-0 grid-cols-[minmax(7rem,40%)_1fr] items-baseline gap-3 border-b border-border py-2.5 text-body-sm"
        >
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className="min-w-0 truncate font-medium text-foreground">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// ─── Document tabs ────────────────────────────────────────────────────────────

export interface DocumentTab {
  key: string;
  label: string;
  /** Shown as a quiet count chip — lines, approvals, events. */
  count?: number;
  content: React.ReactNode;
}

/**
 * The body of a document, in a fixed order on every document type (ADR-036): Lines, Journal
 * items, Approvals, Activity — then Attachments / Other info only where the API has them. A
 * tab whose data the API cannot supply is left out, never drawn empty.
 */
export function DocumentTabs({
  tabs,
  defaultTab,
  label,
  className,
}: {
  tabs: DocumentTab[];
  defaultTab?: string;
  /** Accessible name for the tab list — "Bill sections". */
  label: string;
  className?: string;
}) {
  if (tabs.length === 0) return null;
  return (
    <TabsPrimitive.Root defaultValue={defaultTab ?? tabs[0]!.key} className={className}>
      <TabsPrimitive.List aria-label={label} className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {tabs.map((tab) => (
          <TabsPrimitive.Trigger
            key={tab.key}
            value={tab.key}
            className={cn(
              'inline-flex h-11 shrink-0 items-center gap-2 border-b-2 border-transparent px-3 text-body-sm font-medium text-muted-foreground transition-colors',
              'hover:text-foreground focus-visible:outline-none focus-visible:shadow-ring',
              'data-[state=active]:border-brand-primary data-[state=active]:text-foreground',
            )}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-muted px-1.5 text-caption font-semibold text-muted-foreground">
                {tab.count}
              </span>
            ) : null}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {tabs.map((tab) => (
        <TabsPrimitive.Content key={tab.key} value={tab.key} className="focus-visible:outline-none">
          {tab.content}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}

// ─── Totals ───────────────────────────────────────────────────────────────────

export interface TotalsRow {
  label: string;
  value: React.ReactNode;
}

/**
 * The document's totals, right-aligned under the lines in a fixed order: the breakdown rows
 * (Subtotal, Discount, Tax — only the ones the document has), a rule, **Total**, then **Amount
 * due** largest. For a money-blind viewer the whole block becomes one hidden line: a total
 * with every figure masked says nothing a single sentence does not.
 */
export function TotalsBlock({
  rows,
  total,
  amountDue,
  hidden = false,
  hiddenLabel = 'Amounts are hidden for your role.',
  className,
}: {
  rows: TotalsRow[];
  total: TotalsRow;
  amountDue?: TotalsRow;
  hidden?: boolean;
  hiddenLabel?: string;
  className?: string;
}) {
  if (hidden) {
    return (
      <p
        className={cn(
          'flex items-center gap-2 rounded-panel border border-dashed border-border px-4 py-3 text-body-sm text-muted-foreground',
          className,
        )}
      >
        <Lock size={14} aria-hidden="true" />
        {hiddenLabel}
      </p>
    );
  }
  return (
    <dl className={cn('w-full space-y-2 text-body-sm tabular-nums', className)}>
      {rows.map((row) => (
        <div key={row.label} className="flex justify-between gap-6">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="text-foreground">{row.value}</dd>
        </div>
      ))}
      <div className="flex justify-between gap-6 border-t border-border pt-2 font-semibold">
        <dt className="text-foreground">{total.label}</dt>
        <dd className="text-foreground">{total.value}</dd>
      </div>
      {amountDue ? (
        <div className="flex items-baseline justify-between gap-6 text-h2 font-semibold">
          <dt className="text-foreground">{amountDue.label}</dt>
          <dd className="text-foreground">{amountDue.value}</dd>
        </div>
      ) : null}
    </dl>
  );
}

// ─── Summary rail ─────────────────────────────────────────────────────────────

/**
 * Computed facts about a document — amount paid, balance due, posted at — beside the body on
 * desktop and under the totals on phones. Computed amounts live here, never in a tab.
 */
export function SummaryRail({
  title,
  rows,
  className,
}: {
  title: string;
  rows: TotalsRow[];
  className?: string;
}) {
  return (
    <aside
      aria-label={title}
      className={cn('rounded-panel border border-border bg-surface p-4', className)}
    >
      <p className="mb-2 text-body-sm font-semibold text-foreground">{title}</p>
      <dl className="divide-y divide-border text-body-sm">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-4 py-2">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="text-end font-medium tabular-nums text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}

// ─── Activity timeline ────────────────────────────────────────────────────────

export interface ActivityEntry {
  id: string;
  actor: string;
  /** What happened, after the actor's name — "approved as Finance Manager". */
  summary: React.ReactNode;
  /** Already formatted — "15 Sep 2026, 09:12". */
  at: string;
  /** Machine event code — `bill.approve`. */
  code?: string;
}

/** A record's history, newest first: actor, what happened, when, and the event code. */
export function ActivityTimeline({ entries, className }: { entries: ActivityEntry[]; className?: string }) {
  return (
    <ol className={cn('space-y-0', className)}>
      {entries.map((entry, index) => (
        <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
          {index < entries.length - 1 ? (
            <span aria-hidden="true" className="absolute start-3.5 top-8 bottom-0 w-px bg-border" />
          ) : null}
          <span
            aria-hidden="true"
            className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-surface-subtle text-micro font-semibold text-muted-foreground"
          >
            {initialsFromName(entry.actor)}
          </span>
          <div className="min-w-0 text-body-sm">
            <p className="text-foreground">
              <span className="font-semibold">{entry.actor}</span> {entry.summary}
            </p>
            <p className="text-caption text-muted-foreground">
              {entry.at}
              {entry.code ? <span className="font-mono"> · {entry.code}</span> : null}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}
