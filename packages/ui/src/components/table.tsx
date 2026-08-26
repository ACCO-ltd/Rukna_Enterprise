import * as React from 'react';

import { cn } from '../lib/utils';

/**
 * Data table primitives.
 *
 * Not a data-grid component — deliberately. A grid that owns sorting, paging and selection
 * would be the wrong bet against this API: `GET /projects` and `GET /contracts` have no
 * pagination or sort (B8), so those concerns live in pure feature modules like
 * `filter-projects.ts` where they can be tested without rendering. These are the markup
 * primitives underneath that, and nothing more.
 *
 * `Table` must be wrapped in `TableScroll`. A BOQ or certificate table has more columns
 * than a 375px viewport can hold, and the rule is that wide content scrolls inside its own
 * container — the page body must never scroll sideways.
 *
 * `contain-layout` (CSS `contain: layout`) makes this an independent layout root. Without
 * it, an auto-layout `<table>`'s min-content intrinsic width leaks past `overflow-x: auto`
 * and inflates `documentElement.scrollWidth` in Chromium — the page scrolls sideways even
 * though the table is visually clipped inside the box. No ancestor `min-w-0`, `overflow`,
 * `max-width` or `contain: inline-size` suppresses it; only isolating this container's
 * layout does. This was measured on the IPA detail page at 375px (scrollWidth 428 → 375),
 * with the table still scrolling inside its own box.
 */
export function TableScroll({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      // tabIndex makes the scroll region reachable by keyboard: a scrollable area that can
      // only be panned by pointer is unusable without a mouse.
      tabIndex={0}
      role="region"
      className={cn(
        'w-full overflow-x-auto rounded-lg border border-border contain-layout',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
        className,
      )}
      {...props}
    />
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return <table className={cn('w-full caption-bottom text-sm', className)} {...props} />;
}

export function TableHeader({ className, ...props }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('bg-surface-subtle', className)} {...props} />;
}

/**
 * Forwards a ref because a grid with keyboard navigation has to reach its own rows to move
 * focus between them — see the BOQ grid's roving tab stop.
 */
export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...props }, ref) => (
  <tbody ref={ref} className={cn('divide-y divide-border', className)} {...props} />
));
TableBody.displayName = 'TableBody';

export function TableRow({ className, ...props }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('bg-surface transition-colors hover:bg-surface-subtle', className)} {...props} />;
}

/**
 * `numeric` right-aligns and applies tabular figures, so money and quantities line up on
 * the decimal point down a column. In RTL the logical `text-end` still means "the end of
 * the line", which is where a number belongs in both directions.
 */
export function TableHead({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        'h-11 px-3 text-start align-middle text-xs font-semibold uppercase text-muted-foreground whitespace-nowrap',
        numeric && 'text-end',
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        'px-3 py-3 align-middle text-foreground',
        numeric && 'text-end tabular-nums',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Empty state, spanning the full width of the table.
 *
 * A table that renders its header over nothing reads as a loading failure. This says
 * plainly that there is nothing to show, and takes an optional hint for what to do next.
 */
export function TableEmpty({
  colSpan,
  children,
}: {
  colSpan: number;
  children: React.ReactNode;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-10 text-center text-sm text-muted-foreground">
        {children}
      </td>
    </tr>
  );
}
