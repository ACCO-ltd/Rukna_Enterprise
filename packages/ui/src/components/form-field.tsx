import * as React from 'react';

import { cn } from '../lib/utils';
import { Label } from './label';

export interface FormFieldProps {
  htmlFor: string;
  label: React.ReactNode;
  error?: string | undefined;
  children: React.ReactNode;
  className?: string;
}

export function FormField({ htmlFor, label, error, children, className }: FormFieldProps) {
  const errorId = `${htmlFor}-error`;
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {error ? (
        <p id={errorId} className="text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
