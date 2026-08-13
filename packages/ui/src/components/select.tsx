'use client';

import * as React from 'react';

import { cn } from '../lib/utils';
import { FormFieldContext } from './form-field';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A native `<select>`, deliberately.
 *
 * It is keyboard accessible, screen-reader correct, and renders the platform's own
 * picker on mobile — all things a custom listbox has to reimplement and usually gets
 * subtly wrong. `pe-8` leaves room for the native chevron in both text directions.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  (
    {
      className,
      children,
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
    const describedBy =
      [describedByProp, ctxDescribedBy].filter(Boolean).join(' ') || undefined;

    const isInvalid =
      invalidProp !== undefined
        ? invalidProp
        : field?.hasError
          ? (true as const)
          : undefined;

    const isRequired =
      requiredProp !== undefined
        ? requiredProp
        : field?.required
          ? (true as const)
          : undefined;

    return (
      <select
        ref={ref}
        aria-describedby={describedBy}
        aria-invalid={isInvalid}
        aria-required={isRequired}
        className={cn(
          'flex h-11 w-full rounded-md border border-border-strong bg-surface px-3.5 pe-9 text-sm text-foreground shadow-e1',
          'transition-[border-color,box-shadow] duration-150 hover:border-border-interactive focus:border-brand-primary focus:outline-none focus:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isInvalid === true && 'border-danger focus:border-danger',
          field?.hasSuccess && isInvalid !== true && 'border-success',
          className,
        )}
        {...props}
      >
        {children}
      </select>
    );
  },
);
Select.displayName = 'Select';
