'use client';

import * as React from 'react';

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
 */

export interface ComboboxOption {
  value: string;
  /** The row's text, and what the filter matches against. */
  label: string;
  /** Quiet trailing text — a code, a count. Also matched by the filter. */
  hint?: string;
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
  disabled,
  invalid,
  className,
  'aria-describedby': describedBy,
  'aria-required': required,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [activeIndex, setActiveIndex] = React.useState(0);

  const rootRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const triggerRef = React.useRef<HTMLButtonElement>(null);

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
  // before a click on something behind it resolves.
  React.useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

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
    <div ref={rootRef} className={cn('relative', className)}>
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
        )}
      >
        <span className={cn('min-w-0 truncate', selected ? 'text-foreground' : 'text-muted-foreground')}>
          {selected ? selected.label : placeholder}
        </span>
        <CaretGlyph open={open} />
      </button>

      {open ? (
        <div
          id={`${id}-panel`}
          className="absolute z-30 mt-1 w-full overflow-hidden rounded-panel border border-border bg-surface-elevated shadow-e3"
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
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={onKeyDown}
              className="h-control w-full rounded-control border border-border-strong bg-surface px-3 text-body-sm text-foreground placeholder:text-muted-foreground focus:border-brand-primary focus:outline-none focus:shadow-ring"
            />
          </div>

          <ul id={`${id}-listbox`} role="listbox" className="max-h-56 overflow-y-auto py-1">
            {results.length === 0 ? (
              <li className="px-3 py-2 text-body-sm text-muted-foreground">{emptyLabel}</li>
            ) : (
              results.map((option, index) => (
                <li key={option.value}>
                  <button
                    id={rowId(index)}
                    type="button"
                    role="option"
                    aria-selected={option.value === value}
                    // Same reason as Select's: a test drives these by the value they set, not
                    // by translated display text that is often not unique in a list.
                    data-value={option.value}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => commit(index)}
                    className={cn(
                      'flex min-h-control w-full items-center gap-2 px-3 py-2 text-start text-body-sm',
                      index === activeIndex ? 'bg-surface-selected' : 'bg-transparent',
                      option.value === value ? 'font-semibold text-foreground' : 'text-foreground',
                    )}
                  >
                    {option.hint ? (
                      <span className="shrink-0 font-mono text-caption text-muted-foreground">
                        {option.hint}
                      </span>
                    ) : null}
                    <span className="min-w-0 truncate">{option.label}</span>
                  </button>
                </li>
              ))
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
        </div>
      ) : null}
    </div>
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
