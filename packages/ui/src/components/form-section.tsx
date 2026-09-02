import * as React from 'react';

import { cn } from '../lib/utils';

export interface FormSectionProps extends Omit<React.HTMLAttributes<HTMLElement>, 'title'> {
  title: React.ReactNode;
  description?: React.ReactNode;
  /**
   * `"card"` (default) wraps the section in a bordered panel — appropriate when
   * a form is the primary content of a page and visual separation is needed.
   *
   * `"plain"` renders a heading and separator only — appropriate when sections
   * appear inside an already-bounded surface, or when the card-inside-card
   * composition would feel heavy.
   */
  variant?: 'card' | 'plain';
}

export function FormSection({
  title,
  description,
  variant = 'card',
  className,
  children,
  ...props
}: FormSectionProps) {
  if (variant === 'plain') {
    return (
      <div className={cn('space-y-5', className)} {...(props as React.HTMLAttributes<HTMLDivElement>)}>
        {/* Title, optional description, then one hairline spanning the full column. The rule sits
            below the description rather than between it and the title, so the two lines read as one
            heading block — the section label and what the section is for. */}
        <div className="border-b border-border pb-3">
          <h3 className="text-h3 font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-1 text-caption leading-5 text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className="space-y-5">{children}</div>
      </div>
    );
  }

  return (
    <fieldset
      className={cn(
        'min-w-0 rounded-lg border border-border bg-surface px-5 pb-5 shadow-[var(--shadow-control)] sm:px-6 sm:pb-6',
        className,
      )}
      {...(props as React.HTMLAttributes<HTMLFieldSetElement>)}
    >
      <legend className="px-1 text-sm font-semibold text-foreground">{title}</legend>
      {description ? (
        <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p>
      ) : null}
      <div className="mt-5">{children}</div>
    </fieldset>
  );
}
