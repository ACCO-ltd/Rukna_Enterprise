'use client';

import * as React from 'react';

import { cn } from '../lib/utils';
import { FormFieldContext } from './form-field';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /**
   * Content pinned inside the start of the field — a currency code, a search glyph, a
   * fixed prefix like `ACCO-`.
   *
   * When either slot is passed the input is wrapped in a relative container and given
   * matching padding. When neither is, the markup is byte-identical to what it was before
   * slots existed, so none of the existing call sites change shape.
   */
  startSlot?: React.ReactNode;
  /** Content pinned inside the end of the field — a unit, a clear button, a verdict glyph. */
  endSlot?: React.ReactNode;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  (
    {
      className,
      type,
      startSlot,
      endSlot,
      'aria-describedby': describedByProp,
      'aria-invalid': invalidProp,
      'aria-required': requiredProp,
      ...props
    },
    ref,
  ) => {
    const field = React.useContext(FormFieldContext);

    // Merge context-supplied IDs with any explicit prop. The explicit prop wins
    // the position (comes first), preserving caller intent for ordering.
    const ctxDescribedBy = field
      ? [field.hintId, field.errorId, field.successId].filter(Boolean).join(' ') || undefined
      : undefined;
    const describedBy =
      [describedByProp, ctxDescribedBy].filter(Boolean).join(' ') || undefined;

    // aria-invalid: explicit prop wins; fall back to context's hasError.
    const isInvalid =
      invalidProp !== undefined
        ? invalidProp
        : field?.hasError
          ? (true as const)
          : undefined;

    // aria-required: explicit prop wins; fall back to context's required flag.
    const isRequired =
      requiredProp !== undefined
        ? requiredProp
        : field?.required
          ? (true as const)
          : undefined;

    // Success is a weaker signal than error and must never override it: a field showing a
    // stale tick beside a live failure is worse than showing no tick at all.
    const showSuccess = Boolean(field?.hasSuccess) && isInvalid !== true;

    const control = (
      <input
        ref={ref}
        type={type ?? 'text'}
        aria-describedby={describedBy}
        aria-invalid={isInvalid}
        aria-required={isRequired}
        className={cn(
          'flex h-control w-full rounded-control border border-border-strong bg-surface px-3.5 py-2 text-body-sm text-foreground shadow-e1 placeholder:text-muted-foreground',
          'transition-[border-color,box-shadow] duration-150 hover:border-border-interactive focus:border-brand-primary focus:outline-none focus:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          'read-only:cursor-default read-only:bg-muted read-only:text-muted-foreground',
          // Logical padding, so a slot sits inside the field in both directions.
          startSlot && 'ps-10',
          endSlot && 'pe-10',
          isInvalid === true && 'border-danger focus:border-danger',
          showSuccess && 'border-success',
          field?.isChecking && 'border-border-interactive',
          className,
        )}
        {...props}
      />
    );

    // No slots means no wrapper: the rendered markup stays exactly what it was before
    // slots existed, so every current caller is unaffected.
    if (!startSlot && !endSlot) return control;

    return (
      <div className="relative flex w-full items-center">
        {startSlot ? (
          <span className="pointer-events-none absolute start-3.5 flex items-center text-muted-foreground">
            {startSlot}
          </span>
        ) : null}
        {control}
        {endSlot ? (
          // Not pointer-events-none: an end slot is often a clear or reveal button.
          <span className="absolute end-3.5 flex items-center text-muted-foreground">
            {endSlot}
          </span>
        ) : null}
      </div>
    );
  },
);
Input.displayName = 'Input';
