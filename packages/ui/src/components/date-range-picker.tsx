'use client';

import * as React from 'react';
import { format } from 'date-fns';
import type { DateRange } from 'react-day-picker';

import { cn } from '../lib/utils';
import { Calendar } from './calendar';
import { Popover, PopoverContent, PopoverTrigger } from './popover';
import { parseWireDate, toWireDate } from './date-picker';

/**
 * A date-range field: a trigger showing "d MMM yyyy – d MMM yyyy", and one calendar in range
 * mode in a popover.
 *
 * ─── Why one calendar, not two `DatePicker`s glued together ──────────────────────
 *
 * `finance/ledger-view.tsx` is the one screen with a date range today, and it bolts two
 * independent `DatePicker`s together by hand — two popovers, two months open at once, no
 * relationship enforced between them (nothing stops "from" landing after "to"). `Calendar`
 * (calendar.tsx) already carries `range_start`/`range_end`/`range_middle` styling for
 * `react-day-picker`'s own range mode — written, on the tokens, and unused until now. One
 * calendar picking both ends is the shape react-day-picker is already built for, not a
 * second control wired up beside the first.
 *
 * ─── Two clicks, closes on the second ─────────────────────────────────────────────
 *
 * react-day-picker's range mode sets `to = from` on the very first click, so "a click
 * happened" cannot be the close condition — that would close the popover having picked a
 * single day. `pendingRef` tracks whether this is the first click of a fresh selection; the
 * popover closes on the second, whether that lands after `from` (a real range) or on `from`
 * again (a one-day range) — both are a completed answer.
 */

export interface DateRangePickerProps {
  id: string;
  /** `yyyy-MM-dd`, or `''` when unset. */
  fromValue: string;
  /** `yyyy-MM-dd`, or `''` when unset. */
  toValue: string;
  /** Receives both bounds together — a range is one value, not two independently owned ones. */
  onChange: (range: { from: string; to: string }) => void;
  /** Trigger text when no range is chosen. */
  placeholder?: string;
  min?: string;
  max?: string;
  isDateDisabled?: (date: Date) => boolean;
  /** Label for the clear action. Omit to hide it. */
  clearLabel?: string;
  disabled?: boolean;
  className?: string;
  'aria-describedby'?: string;
}

export function DateRangePicker({
  id,
  fromValue,
  toValue,
  onChange,
  placeholder = 'Select a date range',
  min,
  max,
  isDateDisabled,
  clearLabel,
  disabled,
  className,
  'aria-describedby': describedBy,
}: DateRangePickerProps) {
  const [open, setOpen] = React.useState(false);
  const pendingRef = React.useRef(false);

  const from = parseWireDate(fromValue);
  const to = parseWireDate(toValue);
  const minDate = parseWireDate(min);
  const maxDate = parseWireDate(max);

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

  const commit = (range: DateRange | undefined) => {
    if (!range?.from) {
      pendingRef.current = false;
      onChange({ from: '', to: '' });
      return;
    }

    onChange({ from: toWireDate(range.from), to: toWireDate(range.to ?? range.from) });

    if (!pendingRef.current) {
      // First click of a fresh selection — react-day-picker has already set `to = from`.
      // Stay open for the second click, which picks the real end (even if it lands back on
      // the same day, making a deliberate one-day range).
      pendingRef.current = true;
      return;
    }
    pendingRef.current = false;
    setOpen(false);
  };

  const label = from
    ? to && to.getTime() !== from.getTime()
      ? `${format(from, 'd MMM yyyy')} – ${format(to, 'd MMM yyyy')}`
      : format(from, 'd MMM yyyy')
    : placeholder;

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) pendingRef.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          aria-describedby={describedBy}
          className={cn(
            'flex h-control w-full items-center justify-between gap-2 rounded-control border border-border-strong bg-surface px-3.5 py-2 text-start text-body-sm shadow-e1',
            'transition-[border-color,box-shadow] duration-(--motion-enter) ease-brand',
            'hover:border-border-interactive focus-visible:border-brand-primary focus-visible:outline-none focus-visible:shadow-ring',
            'disabled:cursor-not-allowed disabled:opacity-50',
            className,
          )}
        >
          <span className={cn('truncate tabular-nums', from ? 'text-foreground' : 'text-muted-foreground')}>
            {label}
          </span>
          <CalendarRangeGlyph />
        </button>
      </PopoverTrigger>

      <PopoverContent>
        <Calendar
          mode="range"
          selected={from ? { from, to: to ?? undefined } : undefined}
          defaultMonth={from ?? undefined}
          captionLayout="dropdown"
          startMonth={minDate ?? defaultRangeStart}
          endMonth={maxDate ?? defaultRangeEnd}
          disabled={isDisabled}
          onSelect={commit}
          autoFocus
        />
        {clearLabel && from ? (
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

function CalendarRangeGlyph() {
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
      <path d="M16 2v4M8 2v4M3 10h18M8 15h.01M12 15h.01M16 15h.01" />
    </svg>
  );
}
