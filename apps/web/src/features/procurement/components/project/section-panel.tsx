'use client';

import * as React from 'react';
import { cn } from '@erp/ui';

/**
 * A panel.
 *
 * Same recipe as the Commercial workspace's `SectionCard`: bordered, `rounded-panel`, no shadow —
 * separation is a border, not elevation. Carries an optional description because a cost table
 * whose basis is unstated is a table people mistrust.
 */
export function SectionPanel({
  title,
  description,
  action,
  children,
  className,
  bodyClassName,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section
      className={cn(
        'min-w-0 overflow-hidden rounded-panel border border-border bg-surface',
        className,
      )}
    >
      <div className="flex min-h-12 flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="min-w-0">
          <h3 className="text-h3 font-semibold text-foreground">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-caption text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action}
      </div>
      <div className={cn('px-4 py-3 sm:px-5', bodyClassName)}>{children}</div>
    </section>
  );
}
