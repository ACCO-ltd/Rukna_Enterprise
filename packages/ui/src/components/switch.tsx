'use client';

import * as React from 'react';

import { cn } from '../lib/utils';

export interface SwitchProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/**
 * An on/off setting that takes effect as a setting, not as a choice among options — "Email
 * invoices to the contact". A checkbox is still right for agreeing to something or picking
 * items from a list (ADR-037). Native `role="switch"` button: Space and Enter toggle it.
 */
export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked, onCheckedChange, className, disabled, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border border-transparent transition-colors',
        'duration-(--motion-enter) ease-brand focus-visible:outline-none focus-visible:shadow-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'bg-brand-ink' : 'bg-border-strong',
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          'block size-5 rounded-full bg-surface shadow-e1 transition-transform duration-(--motion-enter) ease-brand',
          checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5',
        )}
      />
    </button>
  ),
);
Switch.displayName = 'Switch';

export interface SwitchFieldProps extends SwitchProps {
  id: string;
  label: React.ReactNode;
  description?: React.ReactNode;
}

/** A switch with its label and an optional one-line description, the label clickable. */
export function SwitchField({ id, label, description, className, ...props }: SwitchFieldProps) {
  const descriptionId = description ? `${id}-description` : undefined;
  return (
    <div className={cn('flex items-start gap-3', className)}>
      <Switch id={id} aria-describedby={descriptionId} {...props} />
      <div className="min-w-0">
        <label htmlFor={id} className="block cursor-pointer text-body-sm font-semibold text-foreground">
          {label}
        </label>
        {description ? (
          <p id={descriptionId} className="text-caption leading-5 text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
    </div>
  );
}
