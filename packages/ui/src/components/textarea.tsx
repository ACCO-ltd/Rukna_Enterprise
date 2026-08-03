import * as React from 'react';

import { cn } from '../lib/utils';

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={rows ?? 3}
      className={cn(
        'flex w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground shadow-sm placeholder:text-muted-foreground',
        'transition-colors hover:border-slate-400 focus:border-brand-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/15',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
