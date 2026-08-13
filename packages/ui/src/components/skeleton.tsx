import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Loading placeholder.
 *
 * Exists because fifty files had each written their own `animate-pulse` block, which is
 * fifty chances for a loading state to look like a different product than the screen it
 * precedes.
 *
 * ─── The rule that makes a skeleton worth having ─────────────────────────────────
 *
 * A skeleton must have the shape of the thing it is replacing. A single grey rectangle
 * where a table will appear tells the reader only that something is happening; a header
 * row over four body rows tells them a table is coming and roughly how big. The second
 * costs one extra component and removes the layout shift when data lands.
 *
 * That is why the composed skeletons below exist and why features should reach for them
 * rather than for bare `Skeleton` — `SkeletonTable` takes the same column count the real
 * table will render.
 *
 * Motion is handled globally: `prefers-reduced-motion` collapses every animation to 1ms in
 * `globals.css`, so nothing here needs its own guard.
 */
export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Applies the pill radius, for avatars and status placeholders. */
  circle?: boolean;
}

export function Skeleton({ className, circle, ...props }: SkeletonProps) {
  return (
    <div
      // aria-hidden throughout: the loading state is announced once by the region that
      // owns it (see the `role="status"` wrappers below), not per placeholder. Without
      // this a screen reader reads "blank blank blank blank" down a skeleton table.
      aria-hidden="true"
      className={cn(
        'animate-pulse bg-muted',
        circle ? 'rounded-full' : 'rounded-control',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Wraps a set of skeletons in the one live region that announces them.
 *
 * `aria-busy` lets assistive technology treat the subtree as in-flight rather than as
 * content, and the visually hidden label is the only thing actually announced.
 */
export function SkeletonRegion({
  label,
  className,
  children,
}: {
  /** Already-translated, e.g. t('common.loading'). */
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className={className}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

// ─── Composed shapes ──────────────────────────────────────────────────────────

/**
 * Table placeholder, framed like the real thing.
 *
 * Rows read their height from `h-row` so a compact user's skeleton is compact too —
 * otherwise the page jumps by 8px per row the moment data arrives.
 */
export function SkeletonTable({
  columns,
  rows = 5,
  label,
  className,
}: {
  columns: number;
  rows?: number;
  label: string;
  className?: string;
}) {
  return (
    <SkeletonRegion label={label} className={className}>
      <div className="overflow-hidden rounded-panel border border-border">
        <div className="flex items-center gap-4 border-b border-border bg-surface-subtle px-3 py-2.5">
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 flex-1" />
          ))}
        </div>
        {Array.from({ length: rows }).map((_, r) => (
          <div
            key={r}
            className={cn(
              'flex h-row items-center gap-4 bg-surface px-3',
              r > 0 && 'border-t border-border',
            )}
          >
            {Array.from({ length: columns }).map((_, c) => (
              <Skeleton
                key={c}
                // Ragged widths read as data. Uniform bars read as a broken loader.
                className={cn('h-3.5 flex-1', c === 0 && 'max-w-28', c === columns - 1 && 'max-w-16')}
              />
            ))}
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

/** Form placeholder — label and control pairs in the two-column grid forms use. */
export function SkeletonForm({
  fields = 6,
  label,
  className,
}: {
  fields?: number;
  label: string;
  className?: string;
}) {
  return (
    <SkeletonRegion label={label} className={className}>
      <div className="rounded-panel border border-border bg-surface p-5">
        <Skeleton className="mb-5 h-4 w-40" />
        <div className="grid gap-5 sm:grid-cols-2">
          {Array.from({ length: fields }).map((_, i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-control w-full" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

/**
 * Record placeholder — command header, tile row, then the body and rail of
 * `RecordLayout`, so a detail page does not reflow when it resolves.
 */
export function SkeletonRecord({ label, className }: { label: string; className?: string }) {
  return (
    <SkeletonRegion label={label} className={cn('flex flex-col gap-5', className)}>
      <div className="rounded-panel border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col gap-2.5">
            <Skeleton className="h-3 w-28" />
            <Skeleton className="h-6 w-72" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-control w-28" />
            <Skeleton className="h-control w-11" />
          </div>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-panel border border-border bg-surface p-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-3 h-7 w-36" />
          </div>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div className="rounded-panel border border-border bg-surface p-5">
          <Skeleton className="h-4 w-32" />
          <div className="mt-4 flex flex-col gap-3">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
        <div className="rounded-panel border border-border bg-surface p-5">
          <Skeleton className="h-4 w-24" />
          <div className="mt-4 flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-3.5 w-full" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonRegion>
  );
}
