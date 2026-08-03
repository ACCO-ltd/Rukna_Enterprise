import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '../lib/utils';

const alertVariants = cva('rounded-md border px-4 py-3 text-sm', {
  variants: {
    variant: {
      error: 'border-danger/20 bg-danger-subtle text-danger',
      warning: 'border-warning/20 bg-warning-subtle text-warning',
      success: 'border-brand-primary/20 bg-surface-subtle text-foreground',
      info: 'border-border bg-surface-subtle text-muted-foreground',
    },
  },
  defaultVariants: { variant: 'info' },
});

export interface AlertProps
  // `title` is omitted from the native attributes so it can carry rich content here
  // rather than being constrained to a tooltip string.
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'>,
    VariantProps<typeof alertVariants> {
  title?: React.ReactNode;
  /**
   * Multiple messages, rendered as a list. The API returns `error.message` as an ARRAY
   * for 400 validation failures — one entry per failed constraint — so those are shown
   * individually rather than concatenated into one unreadable line.
   */
  messages?: string[];
}

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(
  ({ className, variant, title, messages, children, ...props }, ref) => {
    // Errors are announced assertively; everything else politely, so a success or info
    // message does not interrupt what a screen reader user is currently reading.
    const isError = variant === 'error';

    return (
      <div
        ref={ref}
        role={isError ? 'alert' : 'status'}
        aria-live={isError ? 'assertive' : 'polite'}
        className={cn(alertVariants({ variant }), className)}
        {...props}
      >
        {title ? <p className="font-semibold">{title}</p> : null}

        {messages && messages.length > 0 ? (
          messages.length === 1 ? (
            <p className={cn(title && 'mt-1')}>{messages[0]}</p>
          ) : (
            <ul className={cn('list-disc space-y-1 ps-5', title && 'mt-1')}>
              {messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          )
        ) : null}

        {children}
      </div>
    );
  },
);
Alert.displayName = 'Alert';
