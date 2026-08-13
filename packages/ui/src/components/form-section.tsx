import * as React from 'react';

import { cn } from '../lib/utils';

export interface FormSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
  variant?: 'panel' | 'plain';
  className?: string;
}

export function FormSection({ title, description, children, variant = 'panel', className }: FormSectionProps) {
  return (
    <section className={cn('space-y-5', variant === 'panel' && 'rounded-panel border border-border bg-surface p-5 sm:p-6', className)}>
      <header className="border-b border-border pb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
      </header>
      {children}
    </section>
  );
}
