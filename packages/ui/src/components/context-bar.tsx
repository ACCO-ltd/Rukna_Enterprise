import * as React from 'react';
import { Info, Lock, TriangleAlert } from 'lucide-react';

import { cn } from '../lib/utils';

/**
 * The bar a working surface opens with: what this is, what state it is in, the few figures that
 * describe it, and the ONE next step — plus an overflow for everything else.
 *
 * Built for the BOQ tab and deliberately generic: a budget, a cost plan or a payment schedule has
 * the same shape. It is not a record header (no breadcrumb, no identifier, `h2` not `h1`) — it
 * sits inside a workspace whose header already names the record.
 *
 * ─── Rules it encodes ────────────────────────────────────────────────────────────
 *
 *  - One primary at most. When the next step is not available the caller passes no primary and
 *    says why in `note` — never a disabled button.
 *  - Metrics are label + value pairs on one wrapping line, values in tabular figures. They are
 *    facts, not tiles.
 *  - The note row is one line. `attention` gets the warning glyph and word colour; `neutral`
 *    an info glyph; `restricted` a lock (the permission-hidden case).
 */

export interface ContextBarMetric {
  key: string;
  label: React.ReactNode;
  value: React.ReactNode;
}

export type ContextBarNoteTone = 'neutral' | 'attention' | 'restricted';

export interface ContextBarProps {
  title: React.ReactNode;
  /** A status pill from the app's status registry. */
  status?: React.ReactNode;
  metrics?: readonly ContextBarMetric[];
  /** The one primary action, or nothing. */
  primary?: React.ReactNode;
  /** The overflow trigger (a kebab `DropdownMenu`). */
  menu?: React.ReactNode;
  /** One line under the bar: why the primary is missing, what is restricted, what to do. */
  note?: React.ReactNode;
  noteTone?: ContextBarNoteTone;
  /** A link or text button at the end of the note — "Show unpriced". */
  noteAction?: React.ReactNode;
  headingLevel?: 'h2' | 'h3';
  headingId?: string;
  className?: string;
}

const NOTE_ICON: Record<ContextBarNoteTone, typeof Info> = {
  neutral: Info,
  attention: TriangleAlert,
  restricted: Lock,
};

export function ContextBar({
  title,
  status,
  metrics = [],
  primary,
  menu,
  note,
  noteTone = 'neutral',
  noteAction,
  headingLevel = 'h2',
  headingId,
  className,
}: ContextBarProps) {
  const Heading = headingLevel;
  const NoteIcon = NOTE_ICON[noteTone];

  return (
    <section
      aria-labelledby={headingId}
      className={cn('min-w-0 rounded-panel border border-border bg-surface shadow-e1', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-2">
            <Heading id={headingId} className="text-h3 font-semibold text-foreground">
              {title}
            </Heading>
            {status}
          </div>
          {metrics.length > 0 ? (
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-body-sm">
              {metrics.map((metric) => (
                <div key={metric.key} className="flex items-baseline gap-1.5">
                  <dt className="text-muted-foreground">{metric.label}</dt>
                  <dd className="font-semibold tabular-nums text-foreground">{metric.value}</dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
        {primary || menu ? (
          <div className="flex shrink-0 items-center gap-2">
            {primary}
            {menu}
          </div>
        ) : null}
      </div>

      {note ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border px-4 py-2.5 text-body-sm">
          <span
            className={cn(
              'inline-flex min-w-0 items-center gap-2',
              noteTone === 'attention' ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <NoteIcon
              size={15}
              aria-hidden="true"
              className={cn('shrink-0', noteTone === 'attention' ? 'text-warning' : 'text-muted-foreground')}
            />
            <span className="min-w-0">{note}</span>
          </span>
          {noteAction}
        </div>
      ) : null}
    </section>
  );
}
