'use client';

import * as React from 'react';
import { format, isValid, parse } from 'date-fns';

import { cn } from '../lib/utils';
import { Calendar } from './calendar';
import { FormFieldContext } from './form-field';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

/**
 * A date field: a trigger showing the chosen date, and a calendar in a popover.
 *
 * ─── What this replaces, and what was given up ───────────────────────────────────
 *
 * This replaces `DateInput`, a styled native `<input type="date">`. The native control was
 * keyboard-typeable and rendered the platform picker on a phone, and both of those are real
 * losses. What it could not do is look like this product: the calendar it opened was the
 * browser's, unstyled, blind to the dark theme, and different in every browser. It also
 * could not express a business constraint finer than `min`/`max` — an accounting date must
 * fall in an OPEN period, and "these particular days are closed" is not a range.
 *
 * ─── The wire format is a string, deliberately ───────────────────────────────────
 *
 * `value` and `onChange` speak `yyyy-MM-dd`, not `Date`. Every caller already stores dates
 * that way — it is what the API sends, what the form drafts hold, and what the previous
 * native input produced — so taking `Date` here would push a conversion into all fifty call
 * sites and invite each one to do it differently.
 *
 * ─── Why the parsing is hand-rolled to local time ────────────────────────────────
 *
 * `new Date('2026-09-02')` is parsed as **UTC midnight** by specification. Rendered anywhere
 * west of Greenwich that is the evening of 1 September, so a date picker built the obvious
 * way shows the day before the one stored — and, worse, writes it back. `date-fns`'s `parse`
 * and `format` are local-time throughout, which is why they are used for both directions
 * instead of `Date.parse` and `toISOString().slice(0, 10)`.
 */

const WIRE_FORMAT = 'yyyy-MM-dd';

/** `yyyy-MM-dd` → a local-midnight Date, or null if absent or unparseable. */
export function parseWireDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const parsed = parse(value, WIRE_FORMAT, new Date());
  return isValid(parsed) ? parsed : null;
}

/** A Date → `yyyy-MM-dd`, in local time. */
export function toWireDate(date: Date): string {
  return format(date, WIRE_FORMAT);
}

export interface DatePickerProps {
  id: string;
  /** `yyyy-MM-dd`, or `''` when unset. */
  value: string;
  /** Receives `yyyy-MM-dd`, or `''` when the date is cleared. */
  onChange: (value: string) => void;
  /** Trigger text when no date is chosen. */
  placeholder?: string;
  /** Earliest selectable date, `yyyy-MM-dd`. Days before it are disabled, not hidden. */
  min?: string;
  /** Latest selectable date, `yyyy-MM-dd`. */
  max?: string;
  /**
   * Extra day-level predicate, for constraints a range cannot express — an accounting date
   * outside an open period, a non-working day. Return true to disable the day.
   */
  isDateDisabled?: (date: Date) => boolean;
  /** Label for the clear action. Omit to hide it — a required field has nothing to clear to. */
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
}

export function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Select a date',
  min,
  max,
  isDateDisabled,
  clearLabel,
  disabled,
  className,
  'aria-describedby': describedByProp,
}: DatePickerProps) {
  const field = React.useContext(FormFieldContext);
  const [open, setOpen] = React.useState(false);

  const ctxDescribedBy = field
    ? [field.hintId, field.errorId, field.successId].filter(Boolean).join(' ') || undefined
    : undefined;
  const describedBy = [describedByProp, ctxDescribedBy].filter(Boolean).join(' ') || undefined;

  const selected = parseWireDate(value);
  const minDate = parseWireDate(min);
  const maxDate = parseWireDate(max);

  // Twenty years back covers historic contracts and opening balances; ten forward covers any
  // programme date a project carries. Both are only the dropdown's span — `min`/`max` are what
  // actually constrain selection.
  const thisYear = new Date().getFullYear();
  const defaultRangeStart = new Date(thisYear - 20, 0, 1);
  const defaultRangeEnd = new Date(thisYear + 10, 11, 31);

  const isDisabled = React.useCallback(
    (date: Date) => {
      if (minDate && date < minDate) return true;
      if (maxDate && date > maxDate) return true;
      return isDateDisabled?.(date) ?? false;
    },
    [minDate, maxDate, isDateDisabled],
  );

  const commit = (date: Date | undefined) => {
    onChange(date ? toWireDate(date) : '');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-describedby={describedBy}
          aria-invalid={field?.hasError || undefined}
          aria-required={field?.required || undefined}
          className={cn(
            'flex h-control w-full items-center justify-between gap-2 rounded-control border border-border-strong bg-surface px-3.5 py-2 text-start text-body-sm shadow-e1',
            'transition-[border-color,box-shadow] duration-(--motion-enter) ease-brand',
            'hover:border-border-interactive focus-visible:border-brand-primary focus-visible:outline-none focus-visible:shadow-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            field?.hasError && 'border-danger focus-visible:border-danger',
            field?.hasSuccess && !field.hasError && 'border-success',
            className,
          )}
        >
          <span className={cn('truncate tabular-nums', selected ? 'text-foreground' : 'text-muted-foreground')}>
            {selected ? format(selected, 'd MMM yyyy') : placeholder}
          </span>
          <CalendarGlyph />
        </button>
      </PopoverTrigger>

      <PopoverContent>
        <Calendar
          mode="single"
          selected={selected ?? undefined}
          // Opening on the selected month rather than today: someone correcting a date from
          // last quarter should not have to page back to it.
          defaultMonth={selected ?? undefined}
          // Month and year as dropdowns, not just chevrons. Paging one month at a time is fine
          // for "next Tuesday" and useless for a contract that completes in 2029 — which is
          // most of what this product records. The chevrons stay for short hops.
          captionLayout="dropdown"
          // The dropdown needs an explicit span; react-day-picker otherwise offers a hundred
          // years, which is a scroll list nobody can aim at.
          startMonth={minDate ?? defaultRangeStart}
          endMonth={maxDate ?? defaultRangeEnd}
          disabled={isDisabled}
          onSelect={commit}
          autoFocus
        />
        {clearLabel && selected ? (
          <div className="mt-2 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => commit(undefined)}
              className="min-h-control text-caption font-semibold text-brand-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:shadow-ring"
            >
              {clearLabel}
            </button>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function CalendarGlyph() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0 text-muted-foreground"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}
