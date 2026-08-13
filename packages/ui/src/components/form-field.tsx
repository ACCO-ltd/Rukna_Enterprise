import * as React from 'react';

import { cn } from '../lib/utils';
import { Label } from './label';

export interface FormFieldProps {
  htmlFor: string;
  label: React.ReactNode;
  error?: string | undefined;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ htmlFor, label, error, hint, required, children, className }: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}{required ? <span className="ms-1 text-danger" aria-hidden="true">*</span> : null}</Label>
      {children}
      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {!error && hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}
