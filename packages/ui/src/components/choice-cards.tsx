'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

export interface ChoiceCardOption<TValue extends string> {
  value: TValue;
  /** What the option is: "Unit rate". */
  label: React.ReactNode;
  /** What choosing it means: "Quantity × rate". */
  hint?: React.ReactNode;
  disabled?: boolean;
}

export interface ChoiceCardsProps<TValue extends string> {
  /** The question the cards answer. Rendered as the group's visible label. */
  label: React.ReactNode;
  /** Hide the label visually (it is still the group's accessible name). */
  hideLabel?: boolean;
  value: TValue | '';
  onChange: (value: TValue) => void;
  options: readonly ChoiceCardOption<TValue>[];
  /** Columns on `sm+`. Defaults to the number of options, capped at 3. Phones always stack. */
  columns?: 1 | 2 | 3;
  disabled?: boolean;
  className?: string;
}

const columnClass = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' } as const;

/**
 * A small set of mutually exclusive choices drawn as selectable cards — a label and a hint that
 * explains the consequence, e.g. "Unit rate — Quantity × rate" / "Lump sum — One fixed amount".
 * Used inside `FormDialog` where a choice changes which fields follow.
 *
 * Follows the WAI-ARIA radio-group pattern: one tab stop for the whole group (the selected card,
 * or the first enabled one), arrow keys move AND select, Home/End jump, Space selects. Disabled
 * options are skipped. In RTL, Left/Right follow the reading direction.
 *
 * `RadioGroup variant="card"` (choice.tsx) is the same idea on native radios for page-level
 * forms; ChoiceCards is the compact, grid-laid form of it that dialogs use.
 */
export function ChoiceCards<TValue extends string>({
  label,
  hideLabel = false,
  value,
  onChange,
  options,
  columns,
  disabled = false,
  className,
}: ChoiceCardsProps<TValue>) {
  const labelId = React.useId();
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);

  const enabled = (index: number) => !disabled && !options[index]?.disabled;
  const selectedIndex = options.findIndex((option) => option.value === value);
  const tabStop =
    selectedIndex >= 0 && enabled(selectedIndex)
      ? selectedIndex
      : options.findIndex((_, index) => enabled(index));

  const select = (index: number) => {
    const option = options[index];
    if (!option || !enabled(index)) return;
    refs.current[index]?.focus();
    if (option.value !== value) onChange(option.value);
  };

  /** The next enabled index from `from`, stepping by `step`, wrapping. */
  const step = (from: number, delta: 1 | -1) => {
    for (let offset = 1; offset <= options.length; offset += 1) {
      const index = (((from + delta * offset) % options.length) + options.length) % options.length;
      if (enabled(index)) return index;
    }
    return from;
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowDown':
        next = step(index, 1);
        break;
      case 'ArrowUp':
        next = step(index, -1);
        break;
      case 'ArrowRight':
        next = step(index, rtl ? -1 : 1);
        break;
      case 'ArrowLeft':
        next = step(index, rtl ? 1 : -1);
        break;
      case 'Home':
        next = step(options.length - 1, 1);
        break;
      case 'End':
        next = step(0, -1);
        break;
      case ' ':
        next = index;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (next !== null && next >= 0) select(next);
  };

  const cols = columns ?? (Math.min(Math.max(options.length, 1), 3) as 1 | 2 | 3);

  return (
    <div className={cn('min-w-0', className)}>
      <p
        id={labelId}
        className={cn('mb-2 text-body-sm font-medium text-foreground', hideLabel && 'sr-only')}
      >
        {label}
      </p>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        className={cn('grid grid-cols-1 gap-3', columnClass[cols])}
      >
        {options.map((option, index) => {
          const checked = option.value === value;
          const isEnabled = enabled(index);
          // Named by the label alone; the hint is read after it as a description, not run
          // together into one long name.
          const optionLabelId = `${labelId}-${index}-label`;
          const optionHintId = option.hint ? `${labelId}-${index}-hint` : undefined;
          return (
            <button
              key={option.value}
              ref={(element) => {
                refs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-labelledby={optionLabelId}
              aria-describedby={optionHintId}
              aria-disabled={!isEnabled || undefined}
              tabIndex={index === tabStop ? 0 : -1}
              onClick={() => select(index)}
              // A disabled card must not take focus on click either — it is out of the group.
              onMouseDown={(event) => {
                if (!isEnabled) event.preventDefault();
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                'flex min-w-0 items-start gap-3 rounded-panel border p-3.5 text-start transition-colors',
                'duration-(--motion-enter) ease-brand focus-visible:outline-none focus-visible:shadow-ring',
                checked
                  ? 'border-brand-primary bg-surface-selected'
                  : 'border-border-strong bg-surface',
                isEnabled
                  ? cn('cursor-pointer', !checked && 'hover:border-border-interactive hover:bg-surface-hover')
                  : 'cursor-not-allowed opacity-60',
              )}
            >
              {/* The radio mark. Decorative — the button carries role and state. */}
              <span
                aria-hidden="true"
                className={cn(
                  'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                  checked ? 'border-brand-primary' : 'border-border-strong bg-surface',
                )}
              >
                {checked ? <span className="size-2 rounded-full bg-brand-primary" /> : null}
              </span>
              <span className="min-w-0">
                <span id={optionLabelId} className="block text-body-sm font-semibold text-foreground">
                  {option.label}
                </span>
                {option.hint ? (
                  <span id={optionHintId} className="mt-0.5 block text-caption leading-5 text-muted-foreground">
                    {option.hint}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
