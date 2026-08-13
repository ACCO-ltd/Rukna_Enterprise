import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * The one likely next step on a row, plus an overflow.
 *
 * ─── Why rows need actions at all ────────────────────────────────────────────────
 *
 * Every list in the product today requires opening a record to do anything with it. For a
 * queue that is the wrong shape: someone working through seven bills awaiting match wants
 * to review the next match, not to visit seven detail pages and come back six times.
 *
 * ─── Why exactly one visible action ──────────────────────────────────────────────
 *
 * Four buttons per row is a toolbar repeated down the page: it doubles the row height, it
 * competes with the record link for the eye, and at 375px it decides the table's width. One
 * action — the step this row is actually waiting for, which differs per row — and everything
 * else behind the overflow.
 *
 * The primary action is therefore per-row, not per-column: a DRAFT bill offers Submit, a
 * matched one offers Pay, a posted one offers View journal. That is a property of the
 * record's state, and passing it per row is what keeps the column honest.
 */
export function RowActions({
  children,
  overflow,
  className,
}: {
  /** The single primary control for this row. */
  children?: React.ReactNode;
  /** Overflow trigger — a DropdownMenu. Omit when a row has no secondary actions. */
  overflow?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn('flex items-center justify-end gap-1.5', className)}
      // Stops a row-level click handler or link wrapper from firing when someone aims at a
      // button. Without it, "Pay" also navigates to the record and the payment dialog opens
      // on a page that is already unmounting.
      onClick={(event) => event.stopPropagation()}
    >
      {children}
      {overflow}
    </div>
  );
}

/**
 * Horizontal ellipsis for an overflow trigger.
 *
 * A glyph rather than a character: "···" as text is three full stops to a screen reader and
 * inherits letter-spacing, so it drifts off-centre inside a square button.
 */
export function OverflowGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.4" />
      <circle cx="8" cy="8" r="1.4" />
      <circle cx="12.5" cy="8" r="1.4" />
    </svg>
  );
}
