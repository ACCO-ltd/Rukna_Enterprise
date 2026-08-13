import * as React from 'react';

import { cn } from '../lib/utils';
import { Label } from './label';

export interface FormFieldProps {
  htmlFor: string;
  label: React.ReactNode;
  error?: string | undefined;
  hint?: React.ReactNode;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ htmlFor, label, error, hint, required, children, className }: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <span className="ms-1 text-danger" aria-hidden="true">*</span> : null}
      </Label>
      {children}
      {hint && !error ? <p id={hintId} className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
