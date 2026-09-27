import * as React from 'react';

import { cn } from '../lib/utils';

/** What the API sends: Decimal columns arrive as strings to survive the trip intact. */
export type MoneyValue = string | number | null | undefined;

/**
 * Formats USD for display (ADR-024: USD only). Parses only at render time — no arithmetic.
 * Returns null for absent or non-numeric input so the caller never shows a fabricated $0.
 */
export function formatUsd(value: MoneyValue, options: { compact?: boolean } = {}): string | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount)) return null;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    ...(options.compact
      ? { notation: 'compact', maximumFractionDigits: 1 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  }).format(amount);
}

export interface MoneyDisplayProps extends React.HTMLAttributes<HTMLSpanElement> {
  value: MoneyValue;
  /**
   * The viewer may not see this figure (money-blind roles, ADR-029). The server omits the
   * field, so absence alone cannot tell "hidden" from "not applicable" — the caller says so
   * from the capability flags. Renders a muted lock + dash: never `$0.00`, never blank.
   */
  hidden?: boolean;
  /** Renders a skeleton — never a flashed `$0.00` while the figure is on its way. */
  loading?: boolean;
  /** `$1.2M` notation for KPI tiles. Tables always show full precision. */
  compact?: boolean;
  /** Accessible name for the hidden state. */
  hiddenLabel?: string;
  /** Accessible name for the not-applicable dash. */
  unavailableLabel?: string;
}

const LockGlyph = () => (
  <svg
    viewBox="0 0 24 24"
    className="size-3 shrink-0"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect x="3" y="11" width="18" height="11" rx="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

/**
 * A money figure in one of five states that are never conflated (ADR-034):
 *
 *  - known value      → `$48,250.50`
 *  - known zero       → `$0.00` (a zero is a value; a dash is not)
 *  - not applicable   → `—`
 *  - hidden           → lock + `—`, muted
 *  - loading          → skeleton
 *
 * Tabular figures, neutral colour: money is not coloured for being money. Negatives use a
 * leading minus.
 */
export function MoneyDisplay({
  value,
  hidden = false,
  loading = false,
  compact = false,
  hiddenLabel = 'Hidden by permission',
  unavailableLabel = 'Not applicable',
  className,
  ...props
}: MoneyDisplayProps) {
  if (loading) {
    // A span, not `Skeleton`'s div: money sits inside table cells and paragraphs.
    return (
      <span
        aria-hidden="true"
        className={cn('inline-block h-4 w-20 animate-pulse rounded-control bg-muted align-middle', className)}
      />
    );
  }

  if (hidden) {
    return (
      <span
        className={cn('inline-flex items-center gap-1 text-muted-foreground', className)}
        title={hiddenLabel}
        {...props}
      >
        <LockGlyph />
        <span aria-hidden="true">—</span>
        <span className="sr-only">{hiddenLabel}</span>
      </span>
    );
  }

  const formatted = formatUsd(value, { compact });
  if (formatted === null) {
    return (
      <span className={cn('text-muted-foreground', className)} {...props}>
        <span aria-hidden="true">—</span>
        <span className="sr-only">{unavailableLabel}</span>
      </span>
    );
  }

  return (
    <span className={cn('tabular-nums', className)} {...props}>
      {formatted}
    </span>
  );
}
