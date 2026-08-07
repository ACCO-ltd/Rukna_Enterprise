'use client';

import { useId, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  cn,
  Input,
  Label,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';

// ─── Column definition ────────────────────────────────────────────────────────

export interface GridRenderContext {
  locale: 'en' | 'ar';
}

export interface GridColumn<T> {
  /** Unique identifier for this column — used as sort key and React key. */
  key: string;
  /** Already-translated column header text. */
  header: string;
  /**
   * Right-aligns text and applies tabular figures. Use for all money, quantity,
   * and number columns so digits stack on the decimal point.
   */
  numeric?: boolean;
  /**
   * Enables sort toggling on this column. Requires `plainValue` to produce a
   * comparable scalar — columns without it cannot be sorted.
   */
  sortable?: boolean;
  /**
   * Sticky left (or right in RTL) column. Use for the primary identifier (ref,
   * name) so it stays visible when the table scrolls horizontally on mobile.
   */
  sticky?: boolean;
  /**
   * Returns a sortable/searchable scalar for this cell. Used for:
   *   - Client-side ascending/descending sort
   *   - Global text search (the string representation is matched against the query)
   *
   * Not required for decoration-only columns (status badges, action menus).
   */
  plainValue?: (row: T) => string | number | null | undefined;
  /** Renders the cell's visual content. */
  render: (row: T, ctx: GridRenderContext) => React.ReactNode;
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc';

interface SortState {
  key: string;
  direction: SortDirection;
}

function nextSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null; // third click clears sort
}

function sortRows<T>(rows: T[], sort: SortState | null, columns: GridColumn<T>[]): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.plainValue) return rows;

  return [...rows].sort((a, b) => {
    const av = col.plainValue!(a);
    const bv = col.plainValue!(b);

    // Nulls always sort last, regardless of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
    }
    return sort.direction === 'asc' ? cmp : -cmp;
  });
}

// ─── Search ───────────────────────────────────────────────────────────────────

function searchRows<T>(rows: T[], query: string, columns: GridColumn<T>[]): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;

  return rows.filter((row) =>
    columns.some((col) => {
      if (!col.plainValue) return false;
      const v = col.plainValue(row);
      if (v == null) return false;
      return String(v).toLowerCase().includes(needle);
    }),
  );
}

// ─── Sort icon ────────────────────────────────────────────────────────────────

function SortIcon({ direction }: { direction: SortDirection | null }) {
  if (direction === 'asc') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M12 19V5M5 12l7-7 7 7" />
      </svg>
    );
  }
  if (direction === 'desc') {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="12"
        height="12"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        aria-hidden="true"
        className="shrink-0"
      >
        <path d="M12 5v14M5 12l7 7 7-7" />
      </svg>
    );
  }
  // Unsorted: show a faint bidirectional hint so users can see the column is sortable.
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="shrink-0 opacity-30"
    >
      <path d="M8 9l4-4 4 4M16 15l-4 4-4-4" />
    </svg>
  );
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function GridSkeleton({ label }: { label: string }) {
  const tCommon = useTranslations('common');
  return (
    <div role="status" aria-live="polite" aria-label={label}>
      <span className="sr-only">{tCommon('loading')}</span>
      <div className="h-64 animate-pulse rounded-lg border border-border bg-muted" aria-hidden="true" />
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface PlatformDataGridProps<T> {
  /** Column definitions. Order determines display order. */
  columns: GridColumn<T>[];
  /**
   * All rows to display. The grid applies global text search and sort
   * on top of this list — domain filters (status dropdown, date range)
   * should be applied by the caller before passing data here.
   */
  data: T[];
  /** Stable unique key per row — used as the React key. */
  rowKey: (row: T) => string;
  /** Accessible table label (e.g. "Contracts", "Payment Applications"). */
  label: string;

  /**
   * Domain-specific filter controls (status select, date range, etc.).
   * Rendered in the toolbar between the search input and the right slot.
   */
  toolbarLeft?: React.ReactNode;
  /**
   * Right side of the toolbar — typically a "New ..." create button.
   */
  toolbarRight?: React.ReactNode;

  /**
   * Per-row trailing action column. Return the action controls for a given row
   * (e.g. a dropdown menu with status-appropriate commands). When provided the
   * grid appends a narrow trailing column to every row.
   */
  rowActions?: (row: T) => React.ReactNode;

  /**
   * Content shown when `data` is empty (before the grid applies its own search).
   * Use this to show a feature-specific empty state with a create CTA.
   * When omitted the grid shows the standard "no results" message.
   */
  emptyState?: React.ReactNode;

  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
}

/**
 * Standard list presentation for every operational module.
 *
 * Wraps the low-level `Table` primitives with a standardised toolbar (global
 * search, optional domain filters, optional create action), sortable column
 * headers, consistent loading/error/empty states, and an optional per-row
 * action column. All modules should use this component rather than assembling
 * raw tables independently — Tier 6 enhancements (saved views, bulk actions,
 * export) will land here once and apply everywhere.
 *
 * The caller owns data fetching (TanStack Query) and domain filtering. The grid
 * owns global text search and column sort.
 *
 * @example
 * <PlatformDataGrid
 *   columns={[
 *     { key: 'ref', header: t('columns.ref'), sticky: true,
 *       plainValue: (c) => c.contractNumber,
 *       render: (c) => <Link href={`/contracts/${c.id}`}>{c.contractNumber}</Link> },
 *     { key: 'value', header: t('columns.value'), numeric: true, sortable: true,
 *       plainValue: (c) => Number(c.contractValue),
 *       render: (c, { locale }) => formatMoney(c.contractValue, c.currency, locale) },
 *     { key: 'status', header: t('columns.status'),
 *       render: (c) => <StatusBadge status={c.status} label={t(`status.${c.status}`)} /> },
 *   ]}
 *   data={filtered}
 *   rowKey={(c) => c.id}
 *   label={t('title')}
 *   toolbarLeft={<StatusFilter ... />}
 *   toolbarRight={<Button asChild><Link href="/contracts/new">{t('new')}</Link></Button>}
 * />
 */
export function PlatformDataGrid<T>({
  columns,
  data,
  rowKey,
  label,
  toolbarLeft,
  toolbarRight,
  rowActions,
  emptyState,
  isLoading,
  isError,
  onRetry,
}: PlatformDataGridProps<T>) {
  const t = useTranslations('common.grid');
  const locale = useLocale() as 'en' | 'ar';
  const searchId = useId();

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);

  const renderCtx: GridRenderContext = { locale };

  // Apply search then sort. Order matters: sort on the searched subset only.
  const visible = useMemo(() => {
    const searched = searchRows(data, search, columns);
    return sortRows(searched, sort, columns);
  }, [data, search, sort, columns]);

  // ── Loading ──────────────────────────────────────────────────────────────
  if (isLoading) {
    return <GridSkeleton label={label} />;
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <Alert variant="error" messages={[t('loadFailed')]}>
        {onRetry ? (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('retry')}
            </Button>
          </div>
        ) : null}
      </Alert>
    );
  }

  // ── Empty (no data at all — before the grid applies search) ──────────────
  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  const hasSearch = search.trim() !== '';
  const hasActions = Boolean(rowActions);
  const colCount = columns.length + (hasActions ? 1 : 0);

  const ariaSort = (key: string): React.AriaAttributes['aria-sort'] => {
    if (sort?.key !== key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  };

  const sortButtonLabel = (col: GridColumn<T>): string => {
    if (sort?.key === col.key && sort.direction === 'asc') {
      return t('sortDescLabel', { column: col.header });
    }
    if (sort?.key === col.key && sort.direction === 'desc') {
      return t('sortLabel', { column: col.header });
    }
    return t('sortAscLabel', { column: col.header });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Global search */}
        <div className="min-w-0 flex-1">
          <Label htmlFor={searchId} className="sr-only">
            {t('searchLabel')}
          </Label>
          <Input
            id={searchId}
            type="search"
            placeholder={t('searchPlaceholder')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full"
          />
        </div>

        {/* Domain-specific filters (status dropdown, date range, etc.) */}
        {toolbarLeft ? <div className="flex shrink-0 items-center gap-2">{toolbarLeft}</div> : null}

        {/* Right slot — create button, export button, etc. */}
        {toolbarRight ? <div className="shrink-0">{toolbarRight}</div> : null}
      </div>

      {/* Result count — politely announced so screen readers catch filter changes. */}
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t('results', { count: visible.length })}
      </p>

      {/* Table */}
      <TableScroll aria-label={label}>
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead
                  key={col.key}
                  numeric={col.numeric}
                  aria-sort={col.sortable ? ariaSort(col.key) : undefined}
                  className={cn(
                    col.sticky && 'sticky start-0 z-10 bg-surface-subtle shadow-[1px_0_0_0] shadow-border',
                  )}
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      className={cn(
                        'inline-flex w-full items-center gap-1 text-start',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-primary',
                        col.numeric && 'flex-row-reverse',
                      )}
                      aria-label={sortButtonLabel(col)}
                      onClick={() => setSort((prev) => nextSort(prev, col.key))}
                    >
                      <span>{col.header}</span>
                      <SortIcon
                        direction={sort?.key === col.key ? sort.direction : null}
                      />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}

              {/* Actions column header — visually empty, labelled for AT. */}
              {hasActions ? (
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>

          <TableBody>
            {visible.length === 0 ? (
              <TableEmpty colSpan={colCount}>
                <p>{t('noMatches')}</p>
                {hasSearch ? (
                  <div className="mt-4">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSearch('')}
                    >
                      {t('clearSearch')}
                    </Button>
                  </div>
                ) : null}
              </TableEmpty>
            ) : (
              visible.map((row) => (
                <TableRow key={rowKey(row)}>
                  {columns.map((col) => (
                    <TableCell
                      key={col.key}
                      numeric={col.numeric}
                      className={cn(
                        col.sticky &&
                          'sticky start-0 z-10 bg-surface shadow-[1px_0_0_0] shadow-border',
                      )}
                    >
                      {col.render(row, renderCtx)}
                    </TableCell>
                  ))}
                  {hasActions ? (
                    <TableCell className="w-10 text-end">
                      {rowActions!(row)}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>
    </div>
  );
}
