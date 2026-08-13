'use client';

import * as React from 'react';
import { cn } from '@erp/ui';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EmptyStateProps {
  /** Optional icon — should be 32–40px. Use a muted/subtle color. */
  icon?: React.ReactNode;
  /** Short title, e.g. "No projects yet" or "No results". */
  title: string;
  /** One concise supporting sentence. */
  description?: string;
  /** Primary action (Button or Link). */
  action?: React.ReactNode;
  /** Secondary action — e.g. "Clear filters". */
  secondaryAction?: React.ReactNode;
  /**
   * `"page"` (default) — full dashed-border panel, centered, used when the
   * entire content area has nothing to show.
   *
   * `"inline"` — plain centred block without the bordered panel, used inside
   * a table's empty row or a constrained surface.
   */
  variant?: 'page' | 'inline';
  className?: string;
}

/**
 * Standard empty, filtered-empty, error, permission-denied, and not-found
 * states across all operational modules.
 *
 * Use this before reaching for a module-specific implementation — the shared
 * component gives coherent spacing, dark-mode support, and RTL alignment for
 * free.
 *
 * @example
 * <EmptyState
 *   title={t('empty')}
 *   description={t('emptyHint')}
 *   action={<Button asChild><Link href="/projects/new">{t('newProject')}</Link></Button>}
 * />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
  variant = 'page',
  className,
}: EmptyStateProps) {
  const inner = (
    <div className="flex flex-col items-center gap-3 py-10 text-center">
      {icon ? (
        <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-subtle text-muted-foreground">
          {icon}
        </span>
      ) : null}
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {(action || secondaryAction) ? (
        <div className="flex flex-col items-center gap-2 sm:flex-row">
          {action}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );

  if (variant === 'inline') {
    return (
      <div className={cn('text-center', className)}>
        {inner}
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border border-dashed border-border bg-surface px-6',
        className,
      )}
    >
      {inner}
    </div>
  );
}
