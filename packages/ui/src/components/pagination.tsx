'use client';

import { cn } from '../lib/utils';
import { Button } from './button';

/**
 * The "Showing 1–5 of 24" + numbered-pager footer that sits under most list screens.
 *
 * Deliberately page-number based rather than cursor-based — every caller today paginates a
 * server response that already returns a total count, so a numbered pager is honest about
 * where you are and how far there is to go. A cursor-only list (infinite scroll) is a
 * different pattern and doesn't belong on this component.
 *
 * Collapses to a compact `prev  3 / 8  next` form under `sm` rather than rendering every page
 * number, so it never wraps to a second row on a 375px screen.
 */
export interface PaginationProps {
  /** 1-based current page. */
  page: number;
  /** Total number of pages. */
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Total row count, for the "Showing X–Y of Z" label. Omit to hide the label. */
  totalItems?: number;
  /** Rows per page, required alongside `totalItems` to compute the X–Y range. */
  pageSize?: number;
  /** Names the control for assistive tech, e.g. "Purchase requisitions pages". */
  'aria-label': string;
  className?: string;
}

/** How many numbered page buttons to show around the current page before collapsing to `…`. */
const WINDOW = 1;

export function Pagination({
  page,
  pageCount,
  onPageChange,
  totalItems,
  pageSize,
  'aria-label': ariaLabel,
  className,
}: PaginationProps) {
  const clampedCount = Math.max(1, pageCount);
  const current = Math.min(Math.max(1, page), clampedCount);

  const range =
    totalItems !== undefined && pageSize !== undefined && totalItems > 0
      ? {
          from: (current - 1) * pageSize + 1,
          to: Math.min(current * pageSize, totalItems),
          total: totalItems,
        }
      : null;

  return (
    <nav
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center justify-between gap-3', className)}
    >
      {range ? (
        <p className="text-caption text-muted-foreground">
          Showing {range.from}–{range.to} of {range.total}
        </p>
      ) : (
        <span />
      )}

      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={current <= 1}
          onClick={() => onPageChange(current - 1)}
          aria-label="Previous page"
        >
          <ChevronGlyph direction="left" />
        </Button>

        {/* Numbered pages, collapsed on narrow screens to "current / count". */}
        <div className="hidden items-center gap-1 sm:flex">
          {pageNumbers(current, clampedCount).map((entry, index) =>
            entry === 'ellipsis' ? (
              <span
                key={`ellipsis-${index}`}
                className="px-1.5 text-caption text-muted-foreground"
                aria-hidden="true"
              >
                …
              </span>
            ) : (
              <Button
                key={entry}
                type="button"
                variant={entry === current ? 'outline' : 'ghost'}
                size="icon"
                aria-current={entry === current ? 'page' : undefined}
                onClick={() => onPageChange(entry)}
              >
                {entry}
              </Button>
            ),
          )}
        </div>
        <span className="text-caption text-muted-foreground sm:hidden">
          {current} / {clampedCount}
        </span>

        <Button
          type="button"
          variant="ghost"
          size="icon"
          disabled={current >= clampedCount}
          onClick={() => onPageChange(current + 1)}
          aria-label="Next page"
        >
          <ChevronGlyph direction="right" />
        </Button>
      </div>
    </nav>
  );
}

function ChevronGlyph({ direction }: { direction: 'left' | 'right' }) {
  const d = direction === 'left' ? 'M10 3.5 5.5 8l4.5 4.5' : 'M6 3.5 10.5 8 6 12.5';
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type PageEntry = number | 'ellipsis';

function pageNumbers(current: number, count: number): PageEntry[] {
  if (count <= 5 + WINDOW * 2) {
    return Array.from({ length: count }, (_, i) => i + 1);
  }

  const pages = new Set<number>([1, count, current]);
  for (let offset = 1; offset <= WINDOW; offset += 1) {
    if (current - offset > 1) pages.add(current - offset);
    if (current + offset < count) pages.add(current + offset);
  }

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: PageEntry[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) result.push('ellipsis');
    result.push(n);
  });
  return result;
}
