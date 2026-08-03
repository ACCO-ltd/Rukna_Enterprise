import * as React from 'react';

import { cn } from '../lib/utils';

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A native `<select>`, deliberately.
 *
 * It is keyboard accessible, screen-reader correct, and renders the platform's own
 * picker on mobile — all things a custom listbox has to reimplement and usually gets
 * subtly wrong. `pe-8` leaves room for the native chevron in both text directions.
 */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-11 w-full rounded-md border border-border bg-surface px-3 pe-8 text-sm text-foreground shadow-sm',
        'transition-colors hover:border-slate-400 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/15',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';
