import * as React from 'react';

import { cn } from '../lib/utils';
import { Label } from './label';

/**
 * The "search + a few filters" row that sits above almost every list in the product.
 *
 * ─── Why this did not exist ───────────────────────────────────────────────────────
 *
 * Five screens wrote their own version of this exact row — `mr-list.tsx`, `po-list.tsx`,
 * `materials-list.tsx`, `document-register-view.tsx`, `receipts-list.tsx` — each its own
 * `flex flex-wrap gap-*` or grid, its own label element and classes, its own idea of how wide
 * a field should be. A sixth copy, `table-toolbar.tsx`'s `TableToolbar`/`FilterSelect`, was
 * admin-only by file location but not by content — `roles-list.tsx`, `users-list.tsx` and
 * `approval-policy-inventory.tsx` all import it across the feature boundary, which is exactly
 * what a shared component should have been in the first place.
 *
 * `FilterBar` is the layout: a wrapping flex row with `items-end` so a label-plus-control
 * field and a bare button share a baseline. `FilterField` is the one labelled field inside
 * it. Both are deliberately thin — the actual controls (`Input`, `Select`, `DatePicker`,
 * `DateRangePicker`, `Combobox`) are unchanged; this only standardises how they are labelled
 * and sized next to each other.
 */
export interface FilterBarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** `FilterField`s (and any bare control that doesn't need one). */
  children: React.ReactNode;
  /**
   * Trailing controls that don't grow or wrap with the fields — a "Clear filters" button,
   * shown only once something is actually narrowing the list.
   */
  actions?: React.ReactNode;
}

export function FilterBar({ children, actions, className, ...props }: FilterBarProps) {
  return (
    <div className={cn('flex flex-wrap items-end gap-3', className)} {...props}>
      {children}
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export interface FilterFieldProps {
  id: string;
  label: string;
  /**
   * Visually hides the label while keeping it for assistive technology — for the search box,
   * whose placeholder already says what it does on screen.
   */
  hideLabel?: boolean;
  /**
   * Wider flex basis, for the one field people reach for first. Every other field shares the
   * same `flex-1` — they all grow evenly and wrap together at narrow widths — `grow` only
   * raises this field's minimum before that happens.
   */
  grow?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FilterField({ id, label, hideLabel, grow, children, className }: FilterFieldProps) {
  return (
    <div className={cn('min-w-0 flex-1', grow ? 'basis-52' : 'basis-44', className)}>
      <Label
        htmlFor={id}
        className={cn(
          'mb-1.5 block text-micro font-semibold uppercase tracking-[0.06em] text-muted-foreground',
          hideLabel && 'sr-only',
        )}
      >
        {label}
      </Label>
      {children}
    </div>
  );
}
