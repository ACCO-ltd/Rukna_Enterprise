'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * The places people actually work, above a list.
 *
 * ─── Why a list needs these ──────────────────────────────────────────────────────
 *
 * A supplier bills screen is not one list, it is four questions: what needs matching, what
 * is ready to post, what is posted, everything. Today all four are reachable only by
 * setting filters by hand, every session, and the count that tells you whether a queue
 * needs attention is not visible until you have already gone looking.
 *
 * A view is a named filter with its count on the tab. The count is the point — "Awaiting
 * match 7" is a to-do list, "Awaiting match" is a menu item.
 *
 * ─── Not tabs, semantically ──────────────────────────────────────────────────────
 *
 * Rendered as a tablist because that is what it behaves like, but the panel it controls is
 * the grid below rather than swapped content, so `aria-controls` points at the grid's id.
 * Arrow-key roving focus is handled here rather than reached for from Radix, because there
 * is no panel switching to coordinate — only a selection.
 */

export interface SavedView<TId extends string = string> {
  id: TId;
  /** Already-translated. */
  label: string;
  /**
   * Row count for this view. `undefined` while it is unknown — renders nothing rather than
   * a zero, because a zero here reads as "nothing to do" and would be a lie mid-load.
   */
  count?: number;
}

export interface SavedViewsProps<TId extends string = string> {
  views: readonly SavedView<TId>[];
  activeId: TId;
  onSelect: (id: TId) => void;
  /** id of the grid this controls, for `aria-controls`. */
  controls?: string;
  /** Accessible name, already translated — e.g. "Bill views". */
  label: string;
  className?: string;
}

export function SavedViews<TId extends string = string>({
  views,
  activeId,
  onSelect,
  controls,
  label,
  className,
}: SavedViewsProps<TId>) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  /**
   * Roving focus. `dir` is read from the element rather than assumed, so Left means
   * "previous" in English and "next" in Arabic — the same correction Radix applies to its
   * own tabs, and the reason this is not just an index++.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let next: number | null = null;

    if (event.key === 'ArrowRight') next = rtl ? index - 1 : index + 1;
    else if (event.key === 'ArrowLeft') next = rtl ? index + 1 : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = views.length - 1;
    else return;

    event.preventDefault();
    const clamped = ((next % views.length) + views.length) % views.length;
    const view = views[clamped];
    if (view) {
      onSelect(view.id);
      refs.current[clamped]?.focus();
    }
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      className={cn(
        // Scrolls rather than wraps: six views on a narrow screen stay one strip and are
        // swiped. Wrapping to a second row reads as a broken menu. overflow-y-hidden is
        // load-bearing — one axis set to auto forces the other from visible to auto, and
        // the triggers' -mb-px would then draw a vertical scrollbar beside them.
        'flex w-full items-center gap-1 overflow-x-auto overflow-y-hidden border-b border-border',
        className,
      )}
    >
      {views.map((view, index) => {
        const active = view.id === activeId;
        return (
          <button
            key={view.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={controls}
            // Only the selected tab is in the tab order; arrows move between them.
            tabIndex={active ? 0 : -1}
            onClick={() => onSelect(view.id)}
            onKeyDown={(event) => onKeyDown(event, index)}
            className={cn(
              '-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-body-sm transition-colors duration-(--motion-enter) ease-brand',
              // Inset ring, not an outset one and not a box-shadow. The strip is an
              // overflow container on both axes (see the wrapper), and anything drawn
              // outside a tab's own box — a positive outline-offset, or shadow-ring — is
              // clipped by it. A focus indicator that is invisible on the first and last
              // tab is worse than none, because it looks like focus was lost.
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-primary',
              active
                ? 'border-brand-primary font-semibold text-brand-primary'
                : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
            )}
          >
            {view.label}
            {view.count !== undefined ? (
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 font-mono text-micro tabular-nums',
                  active ? 'bg-brand-accent text-brand-primary' : 'bg-muted text-muted-foreground',
                )}
              >
                {view.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
