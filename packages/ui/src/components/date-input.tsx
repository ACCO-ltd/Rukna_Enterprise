'use client';

import * as React from 'react';

import { cn } from '../lib/utils';
import { FormFieldContext } from './form-field';

/**
 * A date field.
 *
 * ─── Why this is a native input and not a calendar popover ───────────────────────
 *
 * The same argument `Select` makes, and for stronger reasons. A native
 * `<input type="date">` is keyboard accessible, screen-reader correct, renders the
 * platform's own picker on a phone, parses locale input, and — the part that matters most
 * here — a custom calendar has to decide what a week looks like, which calendar system to
 * show, and how to lay a month grid out right-to-left. This product is bilingual
 * Arabic/English and runs on site phones. A hand-rolled month grid is where that goes
 * wrong quietly.
 *
 * What was actually wrong before this component existed was not the input, it was that
 * every date field was an unstyled one: browser-chrome borders, its own height, ignoring
 * every token, next to inputs that honoured all of them. On an accounting screen the date
 * is the most-used control and it was the most visibly off-system. This fixes the styling
 * and keeps the semantics.
 *
 * The one native part that cannot be fully tamed is Chrome's calendar glyph. It is tinted
 * to `currentColor` via a filter rather than replaced, because hiding it and drawing our
 * own removes the click target that opens the picker.
 *
 * ─── Accounting dates are not just dates ─────────────────────────────────────────
 *
 * `min`/`max` are ordinary HTML attributes and callers should use them: an accounting date
 * must fall inside an open period, and a completion date cannot precede a start date. The
 * browser will not enforce the business rule, but constraining the picker stops most wrong
 * values before validation has to explain them.
 */
export type DateInputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

export const DateInput = React.forwardRef<HTMLInputElement, DateInputProps>(
  (
    {
      className,
      'aria-describedby': describedByProp,
      'aria-invalid': invalidProp,
      'aria-required': requiredProp,
      ...props
    },
    ref,
  ) => {
    const field = React.useContext(FormFieldContext);

    const ctxDescribedBy = field
      ? [field.hintId, field.errorId, field.successId].filter(Boolean).join(' ') || undefined
      : undefined;
    const describedBy = [describedByProp, ctxDescribedBy].filter(Boolean).join(' ') || undefined;

    const isInvalid =
      invalidProp !== undefined ? invalidProp : field?.hasError ? (true as const) : undefined;
    const isRequired =
      requiredProp !== undefined ? requiredProp : field?.required ? (true as const) : undefined;

    return (
      <input
        ref={ref}
        type="date"
        aria-describedby={describedBy}
        aria-invalid={isInvalid}
        aria-required={isRequired}
        className={cn(
          // `text-sm` rather than the scale's `text-body-sm`, deliberately: Input, Select
          // and Textarea are all still on `text-sm` (14px), and a date field one pixel
          // smaller than the text field beside it is worse than all four being off-scale
          // together. Phase 1 moves the whole field set at once. `h-control` and
          // `rounded-control` resolve to the same values those three hardcode today, so
          // they are already tokenised here at no visual cost.
          'flex h-control w-full rounded-control border border-border-strong bg-surface px-3.5 py-2 text-sm text-foreground shadow-e1',
          // Dates line up in a column of form rows the way money lines up in a table.
          'tabular-nums',
          'transition-[border-color,box-shadow] duration-(--motion-enter) ease-brand',
          'hover:border-border-interactive focus:border-brand-primary focus:outline-none focus:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'read-only:cursor-default read-only:bg-muted read-only:text-muted-foreground',
          // Tint the native picker glyph to the current text colour in both themes. A
          // filter is used rather than replacing the control, because removing it removes
          // the only pointer affordance that opens the picker.
          '[&::-webkit-calendar-picker-indicator]:cursor-pointer',
          '[&::-webkit-calendar-picker-indicator]:opacity-60',
          '[&::-webkit-calendar-picker-indicator]:hover:opacity-100',
          'dark:[&::-webkit-calendar-picker-indicator]:invert',
          isInvalid === true && 'border-danger focus:border-danger',
          field?.hasSuccess && isInvalid !== true && 'border-success',
          className,
        )}
        {...props}
      />
    );
  },
);
DateInput.displayName = 'DateInput';
