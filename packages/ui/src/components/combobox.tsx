'use client';

import * as React from 'react';
import * as PopperPrimitive from '@radix-ui/react-popper';
import * as PortalPrimitive from '@radix-ui/react-portal';

import { cn } from '../lib/utils';

/**
 * A searchable single-select, with an optional action pinned to the foot of the list.
 *
 * ─── Why this exists next to Select ──────────────────────────────────────────────
 *
 * `Select` is a native `<select>` and stays the right control for a short, fixed set — a
 * client type, a billing model. It stops working the moment the set is long enough to need
 * filtering, or open enough that the answer someone needs might not be in it yet. A native
 * `<select>` cannot offer "and if it is not here, add it": the only place to put that is
 * outside the control, which pushes the form around and separates the escape hatch from the
 * question it answers.
 *
 * `footerAction` is that escape hatch, and it is deliberately the last row of the list rather
 * than a button beside the field — it is read at the moment the user has finished scanning
 * the options and concluded theirs is missing, which is the only moment it is wanted.
 *
 * ─── Keyboard and assistive technology ───────────────────────────────────────────
 *
 * The trigger is a plain button. Opening moves focus to the filter input, which carries
 * `role="combobox"` and `aria-activedescendant` pointing at the active row, so arrow keys
 * move a visible highlight without focus ever leaving the text field — the pattern screen
 * readers expect from a combobox, and the one that keeps typing and navigating on the same
 * control. The footer action participates in that navigation as the final row, so it is
 * reachable by keyboard rather than by mouse only.
 *
 * ─── Popper + Portal, not a CSS-relative absolute div ────────────────────────────
 *
 * The panel used to be a plain `position: absolute` sibling of the trigger, sized by a
 * `position: relative` wrapper. That is exactly the positioning `Popover` (popover.tsx)
 * already rejected for the same reason: it clips inside any ancestor with `overflow: hidden`
 * or `overflow: auto` — which is not a hypothetical, it clipped the very first real usage,
 * the `/design` gallery's own `Specimen` chrome. `Popper` supplies collision-aware placement
 * (it flips above the trigger when there is no room below) and `Portal` renders the panel
 * into `document.body`, outside every ancestor's clipping and stacking context — the same
 * combination `Popover`, `Select` and `DropdownMenu` each already assemble internally. Popper
 * carries no focus or dismissal behaviour of its own, so the outside-pointerdown, Escape and
 * focus-on-open logic below is unchanged; only the positioning moved.
 */

export interface ComboboxOption {
  value: string;
  /** The row's text, and what the filter matches against. */
  label: string;
  /** Quiet trailing text — a code, a count. Also matched by the filter. Dropped from the row
   * when `caption` is set — the two occupy the same position and a row does not carry both. */
  hint?: string;
  /**
   * Buckets this option under a labeled section, rendered as "{group} ({count in group})" —
   * "Top Matches (2)", "Recent Suppliers (3)". Grouping goes by array order: put every option
   * for one group together, in the order they should appear. Options without a `group` render
   * flat, so existing callers are unaffected.
   */
  group?: string;
  /** Leading glyph — an icon or a small avatar, ~16px. */
  icon?: React.ReactNode;
  /** Secondary line under the label — a category breadcrumb, a location. */
  caption?: React.ReactNode;
  /** Trailing content, end-aligned — an amount, a status, a remaining quantity. */
  meta?: React.ReactNode;
}

export interface ComboboxProps {
  id: string;
  /** Selected option value, or `''` for none. */
  value: string;
  onChange: (value: string) => void;
  options: readonly ComboboxOption[];
  /** Trigger text when nothing is selected. */
  placeholder: string;
  searchPlaceholder: string;
  /** Shown in place of the list when the filter matches nothing. */
  emptyLabel: string;
  /** Pinned last row — "Create new …". Closes the panel before running. */
  footerAction?: { label: string; onSelect: () => void };
  /**
   * Shows a loading row instead of the list — for a server-driven search where `options`
   * hasn't caught up with what was just typed yet. The filter input stays interactive.
   */
  loading?: boolean;
  loadingLabel?: string;
  /**
   * Fires on every keystroke in the filter input, in addition to the panel's own client-side
   * filtering — wire this to a debounced server search that replaces `options` as results
   * arrive. Filtering `options` client-side too is harmless: server results already matching
   * the same text pass straight through.
   */
  onQueryChange?: (query: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  className?: string;
  'aria-describedby'?: string;
  'aria-required'?: boolean;
}

export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  emptyLabel,
  footerAction,
  loading,
  loadingLabel,
  onQueryChange,
  disabled,
  invalid,
  className,
  'aria-describedby': describedBy,
  'aria-required': required,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);

  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);

  const selected = options.find((option) => option.value === value);

  const results = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(q) || (option.hint ?? '').toLowerCase().includes(q),
    );
  }, [options, query]);

  // The footer action is the row after the last result, so one index space covers both.
  const rowCount = results.length + (footerAction ? 1 : 0);
  const footerIndex = footerAction ? results.length : -1;

  React.useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  // Close on an outside pointer press. Pointerdown rather than click so the panel is gone
  // before a click on something behind it resolves. Checked against the trigger AND the
  // panel separately — the panel is portaled, so it is a React descendant but not a DOM
  // descendant of the trigger's wrapper, and `contains` only ever sees the DOM tree.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  // Not a plain `useEffect` keyed on `open`: Popper's `Content` measures the anchor before it
  // places and mounts its real children, one commit later than `open` flipping true — an
  // effect keyed only on `open` fires while `inputRef.current` is still null. `onPlaced` is
  // Popper's own signal that positioning (and therefore the content) is actually ready.
  const focusInput = React.useCallback(() => inputRef.current?.focus(), []);

  const close = (returnFocus = true) => {
    setOpen(false);
    setQuery('');
    if (returnFocus) triggerRef.current?.focus();
  };

  const commit = (index: number) => {
    if (index === footerIndex && footerAction) {
      // Closing first matters: the action opens a dialog, and two layers competing for focus
      // is how a dialog ends up behind a listbox.
      close(false);
      footerAction.onSelect();
      return;
    }
    const option = results[index];
    if (!option) return;
    onChange(option.value);
    close();
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (rowCount === 0) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => (current + step + rowCount) % rowCount);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      commit(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };

  const rowId = (index: number) => `${id}-row-${index}`;

  return (
    <PopperPrimitive.Root>
      <PopperPrimitive.Anchor asChild>
        <button
          ref={triggerRef}
          id={id}
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          aria-haspopup="listbox"
          aria-describedby={describedBy}
          aria-required={required}
          aria-invalid={invalid || undefined}
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              setOpen(true);
            }
          }}
          className={cn(
            'flex h-control w-full items-center justify-between gap-2 rounded-control border border-border-strong bg-surface px-3.5 py-2 text-start text-body-sm shadow-e1',
            'transition-[border-color,box-shadow] duration-150 hover:border-border-interactive focus-visible:border-brand-primary focus-visible:outline-none focus-visible:shadow-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            invalid && 'border-danger focus-visible:border-danger',
            className,
          )}
        >
          <span className={cn('min-w-0 truncate', selected ? 'text-foreground' : 'text-muted-foreground')}>
            {selected ? selected.label : placeholder}
          </span>
          <CaretGlyph open={open} />
        </button>
      </PopperPrimitive.Anchor>

      {open ? (
        <PortalPrimitive.Portal>
          <PopperPrimitive.Content
            ref={panelRef}
            id={`${id}-panel`}
            side="bottom"
            align="start"
            sideOffset={4}
            avoidCollisions
            onPlaced={focusInput}
            className="z-30 w-(--radix-popper-anchor-width) overflow-hidden rounded-panel border border-border bg-surface-elevated shadow-e3"
          >
            <div className="border-b border-border p-2">
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={`${id}-listbox`}
                aria-autocomplete="list"
                aria-activedescendant={rowCount > 0 ? rowId(activeIndex) : undefined}
                autoComplete="off"
                placeholder={searchPlaceholder}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  onQueryChange?.(event.target.value);
                }}
                onKeyDown={onKeyDown}
                className="h-control w-full rounded-control border border-border-strong bg-surface px-3 text-body-sm text-foreground placeholder:text-muted-foreground focus:border-brand-primary focus:outline-none focus:shadow-ring"
              />
            </div>

            <ul id={`${id}-listbox`} role="listbox" className="max-h-56 overflow-y-auto py-1">
              {loading ? (
                <li className="flex flex-col items-center gap-2 px-3 py-6 text-center" aria-hidden="true">
                  <SpinnerGlyph />
                  <span className="text-body-sm text-muted-foreground">
                    {loadingLabel ?? 'Loading…'}
                  </span>
                </li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-body-sm text-muted-foreground">{emptyLabel}</li>
              ) : (
                results.map((option, index) => {
                  const previousGroup = index > 0 ? results[index - 1]!.group : undefined;
                  const groupCount = option.group
                    ? results.filter((o) => o.group === option.group).length
                    : 0;

                  return (
                    <React.Fragment key={option.value}>
                      {option.group && option.group !== previousGroup ? (
                        <li
                          role="presentation"
                          className="px-3 pb-1 pt-2.5 text-micro font-semibold uppercase tracking-wide text-muted-foreground first:pt-1"
                        >
                          {option.group} ({groupCount})
                        </li>
                      ) : null}
                      <li>
                        <button
                          id={rowId(index)}
                          type="button"
                          role="option"
                          aria-selected={option.value === value}
                          // Same reason as Select's: a test drives these by the value they set,
                          // not by translated display text that is often not unique in a list.
                          data-value={option.value}
                          onMouseEnter={() => setActiveIndex(index)}
                          onClick={() => commit(index)}
                          className={cn(
                            'flex min-h-control w-full items-center gap-2.5 px-3 py-2 text-start text-body-sm',
                            index === activeIndex ? 'bg-surface-selected' : 'bg-transparent',
                            option.value === value
                              ? 'font-semibold text-brand-primary'
                              : 'text-foreground',
                          )}
                        >
                          {option.icon ? (
                            <span className="shrink-0 text-muted-foreground" aria-hidden="true">
                              {option.icon}
                            </span>
                          ) : null}
                          {option.hint && !option.caption ? (
                            <span className="shrink-0 font-mono text-caption text-muted-foreground">
                              {option.hint}
                            </span>
                          ) : null}
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{option.label}</span>
                            {option.caption ? (
                              <span className="block truncate text-caption font-normal text-muted-foreground">
                                {option.caption}
                              </span>
                            ) : null}
                          </span>
                          {option.meta ? (
                            <span className="shrink-0 text-end text-caption text-muted-foreground">
                              {option.meta}
                            </span>
                          ) : null}
                          {option.value === value ? (
                            // The chosen row is marked, not merely bolded: in a filtered list
                            // the selection is often scrolled out of the first screen, and
                            // weight alone is not something you can scan for.
                            <CheckGlyph />
                          ) : null}
                        </button>
                      </li>
                    </React.Fragment>
                  );
                })
              )}
            </ul>

            {footerAction ? (
              <div className="border-t border-border">
                <button
                  id={rowId(footerIndex)}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onMouseEnter={() => setActiveIndex(footerIndex)}
                  onClick={() => commit(footerIndex)}
                  className={cn(
                    'flex min-h-control w-full items-center gap-2 px-3 py-2 text-start text-body-sm font-semibold text-brand-primary',
                    activeIndex === footerIndex ? 'bg-surface-selected' : 'bg-transparent',
                  )}
                >
                  <PlusGlyph />
                  {footerAction.label}
                </button>
              </div>
            ) : null}
          </PopperPrimitive.Content>
        </PortalPrimitive.Portal>
      ) : null}
    </PopperPrimitive.Root>
  );
}

// ─── Glyphs ───────────────────────────────────────────────────────────────────
// Inline for the same reason as FormField's: packages/ui carries no icon dependency.

function CaretGlyph({ open }: { open: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function CheckGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className="ms-auto shrink-0 text-brand-primary"
    >
      <path
        d="M2 6.4l2.6 2.6L10 3.4"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SpinnerGlyph() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className="animate-spin text-muted-foreground"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" strokeOpacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

function PlusGlyph() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
