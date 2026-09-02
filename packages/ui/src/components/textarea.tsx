'use client';

import * as React from 'react';

import { cn } from '../lib/utils';
import { FormFieldContext } from './form-field';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  (
    {
      className,
      rows,
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
      <textarea
        ref={ref}
        rows={rows ?? 3}
        aria-describedby={describedBy}
        aria-invalid={isInvalid}
        aria-required={isRequired}
        className={cn(
          'flex min-h-28 w-full resize-y rounded-control border border-border-strong bg-surface px-3.5 py-3 text-body-sm leading-6 text-foreground shadow-e1 placeholder:text-muted-foreground',
          'transition-[border-color,box-shadow] duration-150 hover:border-border-interactive focus:border-brand-primary focus:outline-none focus:shadow-ring',
          'disabled:cursor-not-allowed disabled:opacity-50',
          isInvalid === true && 'border-danger focus:border-danger',
          field?.hasSuccess && isInvalid !== true && 'border-success',
          className,
        )}
        {...props}
      />
    );
  },
);
Textarea.displayName = 'Textarea';
