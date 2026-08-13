import * as React from 'react';

import { cn } from '../lib/utils';

export interface FormSectionProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  variant?: 'bordered' | 'plain';
}

export function FormSection({ title, description, children, className, variant = 'bordered' }: FormSectionProps) {
  return (
    <section className={cn(variant === 'bordered' && 'rounded-md border border-border bg-surface p-5', className)}>
      <header className="mb-5 border-b border-border pb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm leading-5 text-muted-foreground">{description}</p> : null}
      </header>
      <div className="space-y-5">{children}</div>
    </section>
  );
}
