'use client';

import { useId, useMemo, useState, useCallback } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import {
  Alert,
  Button,
  Checkbox,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Label,
  Select,
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
  TableScroll,
} from '@erp/ui';
import { Columns, X } from '@phosphor-icons/react';

// ─── Column definition ────────────────────────────────────────────────────────

export interface GridRenderContext {
  locale: 'en' | 'ar';
}

export interface GridColumn<T> {
  /** Unique identifier — used as sort key, visibility key, and React key. */
  key: string;
  /** Already-translated column header text. */
  header: string;
  /**
   * Right-aligns text and applies tabular figures. Use for all money, quantity,
   * and number columns so digits stack on the decimal point.
   */
  numeric?: boolean;
  /** Enables sort toggling. Requires `plainValue`. */
  sortable?: boolean;
  /**
   * Sticky start column. Use for the primary identifier so it stays visible
   * when the table scrolls horizontally on mobile.
   */
  sticky?: boolean;
  /**
   * Whether to show this column by default when column visibility is enabled.
   * Defaults to `true`. Sticky columns are always visible.
   */
  defaultVisible?: boolean;
  /**
   * Returns a sortable/searchable scalar for this cell.
   * Required for `sortable: true`. Also powers global text search.
   */
  plainValue?: (row: T) => string | number | null | undefined;
  /** Renders the cell's visual content. */
  render: (row: T, ctx: GridRenderContext) => React.ReactNode;
}

// ─── Pagination ───────────────────────────────────────────────────────────────

export interface PaginationConfig {
  /** Initial page size. Default: 25. */
  defaultPageSize?: number;
  /** Available page size options. Default: [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
}

// ─── Selection ────────────────────────────────────────────────────────────────

export interface SelectionConfig {
  selected: Set<string>;
  onSelect: (key: string, checked: boolean) => void;
  onSelectAll: (checked: boolean) => void;
  /** Bulk actions rendered above the table when items are selected. */
  actions: React.ReactNode;
}

// ─── Sort ─────────────────────────────────────────────────────────────────────

type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: string;
  direction: SortDirection;
}

export function nextSort(current: SortState | null, key: string): SortState | null {
  if (current?.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
}

export function sortRows<T>(rows: T[], sort: SortState | null, columns: GridColumn<T>[]): T[] {
  if (!sort) return rows;
  const col = columns.find((c) => c.key === sort.key);
  if (!col?.plainValue) return rows;

  return [...rows].sort((a, b) => {
    const av = col.plainValue!(a);
    const bv = col.plainValue!(b);

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

export function searchRows<T>(rows: T[], query: string, columns: GridColumn<T>[]): T[] {
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

// ─── Pagination controls ──────────────────────────────────────────────────────

function PaginationBar({
  page,
  totalPages,
  from,
  to,
  count,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  totalPages: number;
  from: number;
  to: number;
  count: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (p: number) => void;
  onPageSizeChange: (size: number) => void;
}) {
  const t = useTranslations('common.grid');
  const pageLabelId = useId();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
      <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
        {t('showing', { from, to, count })}
      </p>

      <div className="flex items-center gap-3">
        {/* Page size selector */}
        <div className="flex items-center gap-1.5">
          <label htmlFor={pageLabelId} className="whitespace-nowrap text-xs text-muted-foreground">
            {t('perPage')}
          </label>
          <Select
            id={pageLabelId}
            value={String(pageSize)}
            onChange={(value) => onPageSizeChange(Number(value))}
          >
            {pageSizeOptions.map((opt) => (
              <option key={opt} value={String(opt)}>{opt}</option>
            ))}
          </Select>
        </div>

        {/* Page navigation */}
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('prevPage')}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            className="flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-hover disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="rtl:rotate-180"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
          <span className="min-w-[6rem] text-center text-xs text-muted-foreground">
            {t('page', { page, total: totalPages })}
          </span>
          <button
            type="button"
            aria-label={t('nextPage')}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            className="flex h-8 w-8 items-center justify-center rounded border border-border bg-surface text-foreground hover:bg-surface-hover disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="rtl:rotate-180"><path d="M9 18l6-6-6-6"/></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PlatformDataGridProps<T> {
  /** Column definitions. Order determines display order. */
  columns: GridColumn<T>[];
  /**
   * Domain-filtered rows. The grid applies its own text search and sort on top.
   * Domain filters (status, date range) should be applied by the caller first.
   */
  data: T[];
  /** Stable unique key per row. */
  rowKey: (row: T) => string;
  /** Accessible table label (e.g. "Contracts", "Projects"). */
  label: string;

  // ── Saved views ────────────────────────────────────────────────────────────

  /**
   * Named filters with counts, rendered as a tab strip above the toolbar.
   *
   * The grid does not apply them — the caller filters `data` from the active view, the same
   * arrangement as every other domain filter. What the grid owns is the strip's placement
   * and the `aria-controls` link to the table, so a view change is announced as a change to
   * this table rather than as navigation.
   *
   * Pass a `<SavedViews>` element. Kept as a slot rather than a config object because a
   * view's count usually comes from a different query than its rows, and the caller is the
   * only thing that knows whether that query has resolved.
   */
  savedViews?: React.ReactNode;

  // ── Toolbar ────────────────────────────────────────────────────────────────

  /**
   * Domain-specific filter controls (status select, date range, etc.).
   * Rendered between the search input and the right slot.
   * Alias: `toolbarLeft` (kept for backward compatibility).
   */
  toolbarFilters?: React.ReactNode;
  /** @deprecated Use toolbarFilters */
  toolbarLeft?: React.ReactNode;

  /**
   * Right side of the toolbar — typically a "New …" create button.
   * Alias: `toolbarRight` (kept for backward compatibility).
   */
  toolbarActions?: React.ReactNode;
  /** @deprecated Use toolbarActions */
  toolbarRight?: React.ReactNode;

  // ── Row features ───────────────────────────────────────────────────────────

  /** Per-row trailing action column (e.g. overflow menu). */
  rowActions?: (row: T) => React.ReactNode;

  /**
   * Compact mobile row renderer. When provided it is shown on small screens
   * (< md breakpoint) instead of the full-width table.
   * If omitted, horizontal table scrolling is used on all viewports.
   */
  mobileRow?: (row: T, ctx: GridRenderContext) => React.ReactNode;

  // ── Optional features ──────────────────────────────────────────────────────

  /** Enable the column visibility toggle menu in the toolbar. */
  columnVisibility?: boolean;

  /**
   * Enable client-side pagination. The grid slices the sorted+searched rows
   * using the configured page size.
   */
  pagination?: PaginationConfig;

  /**
   * Row selection. Only provide when the caller has bulk actions to perform —
   * a checkbox column that does nothing is not useful.
   */
  selection?: SelectionConfig;

  // ── States ─────────────────────────────────────────────────────────────────

  isLoading?: boolean;
  isError?: boolean;
  onRetry?: () => void;
  /** Override the default error message (for domain-specific wording). */
  errorMessage?: string;
  /** Override the default "Try again" retry label. */
  retryLabel?: string;

  /**
   * Shown when `data` is empty (before the grid applies its own search).
   * Use for feature-specific empty states with a create CTA.
   */
  emptyState?: React.ReactNode;

  /**
   * Shown when domain-filtered data + grid search together produce no results
   * (data.length > 0 but visible.length === 0). When provided takes precedence
   * over `noMatchMessage` and `clearFiltersLabel`.
   */
  noMatchContent?: React.ReactNode;

  /**
   * Override the "no results match your search" message text.
   * Used when domain-specific wording is more appropriate
   * (e.g. "No clients match these filters.").
   */
  noMatchMessage?: string;

  /**
   * Override the clear button label on the no-match state.
   * Defaults to "Clear search". Pass "Clear filters" when the button
   * should communicate that domain filters are also considered.
   */
  clearFiltersLabel?: string;

  // ── Customisation ──────────────────────────────────────────────────────────

  /** Override the default "Search" label (for domain-specific screen-reader text). */
  searchLabel?: string;
  /** Override the default search placeholder. */
  searchPlaceholder?: string;
  /**
   * Custom count renderer. Receives the number of visible rows and returns the
   * display string (e.g. "2 clients").
   * When omitted the grid uses the default "{count} result(s)" string.
   */
  resultLabel?: (count: number) => string;

  /**
   * Summary of the money in view, rendered beside the result count.
   *
   * A financial list that does not add up its own column forces the reader into a
   * spreadsheet to answer "how much is outstanding" — the question the list exists to
   * answer. Receives the rows currently visible after search, sort and paging, so the total
   * always matches what is on screen rather than what was fetched.
   *
   * Return `null` for a non-financial list.
   */
  footerSummary?: (visibleRows: T[], allFilteredRows: T[]) => React.ReactNode;
}

// ─── Destructure helpers ──────────────────────────────────────────────────────

// Extract extra props from the function signature below.
// TypeScript will infer from the interface above.

// ─── Main component ───────────────────────────────────────────────────────────

/**
 * Standard list presentation for every operational module.
 *
 * Provides a stable toolbar (global text search, domain filter slot, create
 * action), sortable headers, column visibility toggles, client-side pagination,
 * a mobile row renderer slot, and consistent loading/error/empty states.
 *
 * All modules should use this rather than assembling raw tables independently.
 * The caller owns data fetching (TanStack Query) and domain filtering; the grid
 * owns text search and column sort.
 */
export function PlatformDataGrid<T>({
  columns,
  data,
  rowKey,
  label,
  savedViews,
  footerSummary,
  toolbarFilters,
  toolbarLeft,
  toolbarActions,
  toolbarRight,
  rowActions,
  mobileRow,
  columnVisibility: enableColumnVisibility,
  pagination: paginationConfig,
  selection,
  isLoading,
  isError,
  onRetry,
  errorMessage,
  retryLabel,
  emptyState,
  noMatchContent,
  noMatchMessage,
  clearFiltersLabel,
  searchLabel,
  searchPlaceholder,
  resultLabel,
}: PlatformDataGridProps<T>) {
  const t = useTranslations('common.grid');
  const locale = useLocale() as 'en' | 'ar';
  const searchId = useId();

  // ── State ──────────────────────────────────────────────────────────────────

  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);

  const DEFAULT_PAGE_SIZES = [10, 25, 50, 100];
  const defaultPageSize = paginationConfig?.defaultPageSize ?? 25;
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const pageSizeOptions = paginationConfig?.pageSizeOptions ?? DEFAULT_PAGE_SIZES;

  // Column visibility state — initialize from defaultVisible (defaults to true)
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(() => {
    const hidden = new Set<string>();
    columns.forEach((col) => {
      if (!col.sticky && col.defaultVisible === false) hidden.add(col.key);
    });
    return hidden;
  });

  const toggleColumn = useCallback((key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const visibleColumns = useMemo(
    () => (enableColumnVisibility ? columns.filter((c) => !hiddenColumns.has(c.key)) : columns),
    [columns, hiddenColumns, enableColumnVisibility],
  );

  const renderCtx: GridRenderContext = { locale };

  // ── Computed ───────────────────────────────────────────────────────────────

  const searched = useMemo(() => searchRows(data, search, visibleColumns), [data, search, visibleColumns]);
  const sorted = useMemo(() => sortRows(searched, sort, visibleColumns), [searched, sort, visibleColumns]);

  // Pagination
  const totalPages = paginationConfig ? Math.max(1, Math.ceil(sorted.length / pageSize)) : 1;
  const safePage = Math.min(page, totalPages);
  const visible = paginationConfig
    ? sorted.slice((safePage - 1) * pageSize, safePage * pageSize)
    : sorted;
  const from = paginationConfig ? (safePage - 1) * pageSize + 1 : 1;
  const to = paginationConfig ? Math.min(safePage * pageSize, sorted.length) : sorted.length;

  const hasSearch = search.trim() !== '';
  const hasActions = Boolean(rowActions);
  const hasSelection = Boolean(selection);
  const colCount =
    visibleColumns.length + (hasActions ? 1 : 0) + (hasSelection ? 1 : 0);

  // Merge toolbar slots (support both old and new prop names)
  const filtersSlot = toolbarFilters ?? toolbarLeft;
  const actionsSlot = toolbarActions ?? toolbarRight;

  // ── Loading ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return <GridSkeleton label={label} />;
  }

  // ── Error ──────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <Alert variant="error" messages={[errorMessage ?? t('loadFailed')]}>
        {onRetry ? (
          <div className="mt-3">
            <Button variant="outline" size="sm" onClick={onRetry}>
              {retryLabel ?? t('retry')}
            </Button>
          </div>
        ) : null}
      </Alert>
    );
  }

  // ── Dataset empty (before grid search) ────────────────────────────────────

  if (data.length === 0 && emptyState) {
    return <>{emptyState}</>;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  const ariaSort = (key: string): React.AriaAttributes['aria-sort'] => {
    if (sort?.key !== key) return 'none';
    return sort.direction === 'asc' ? 'ascending' : 'descending';
  };

  const sortButtonLabel = (col: GridColumn<T>): string => {
    if (sort?.key === col.key && sort.direction === 'asc') return t('sortDescLabel', { column: col.header });
    if (sort?.key === col.key && sort.direction === 'desc') return t('sortLabel', { column: col.header });
    return t('sortAscLabel', { column: col.header });
  };

  const handlePageSizeChange = (size: number) => {
    setPageSize(size);
    setPage(1);
  };

  const countText = resultLabel
    ? resultLabel(sorted.length)
    : t('results', { count: sorted.length });

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* ── Saved views ─────────────────────────────────────────────────── */}
      {savedViews}

      {/* ── Toolbar ─────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Global text search */}
        <div className="min-w-0 flex-1 basis-48">
          <Label htmlFor={searchId} className="sr-only">
            {searchLabel ?? t('searchLabel')}
          </Label>
          <Input
            id={searchId}
            type="search"
            placeholder={searchPlaceholder ?? t('searchPlaceholder')}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full"
          />
        </div>

        {/* Domain-specific filter controls */}
        {filtersSlot ? (
          <div className="flex shrink-0 items-center gap-2">{filtersSlot}</div>
        ) : null}

        {/* Column visibility */}
        {enableColumnVisibility ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Columns size={15} aria-hidden="true" />
                {t('columnVisibility')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {columns
                .filter((col) => !col.sticky)
                .map((col) => (
                  <DropdownMenuItem
                    key={col.key}
                    onSelect={() => toggleColumn(col.key)}
                    className="gap-2"
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        'flex h-4 w-4 shrink-0 items-center justify-center rounded border border-border',
                        !hiddenColumns.has(col.key) && 'bg-brand-primary border-brand-primary',
                      )}
                    >
                      {!hiddenColumns.has(col.key) ? (
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>
                      ) : null}
                    </span>
                    {col.header}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}

        {/* Right slot — create button etc. */}
        {actionsSlot ? <div className="shrink-0">{actionsSlot}</div> : null}
      </div>

      {/* ── Bulk action bar (when rows selected) ──────────────────────────── */}
      {hasSelection && selection && selection.selected.size > 0 ? (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-subtle px-4 py-2">
          <span className="text-sm font-medium text-foreground">
            {selection.selected.size} selected
          </span>
          {selection.actions}
        </div>
      ) : null}

      {/* ── Result count / money summary / clear search ─────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p
          className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground"
          role="status"
          aria-live="polite"
        >
          <span>{countText}</span>
          {/* Inside the same live region as the count: when a filter changes, "4 bills" and
              "2 071 350.00 outstanding" are one announcement, not two. */}
          {footerSummary ? footerSummary(visible, sorted) : null}
        </p>
        {hasSearch && visible.length > 0 ? (
          <button
            type="button"
            onClick={() => { setSearch(''); setPage(1); }}
            className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-primary rounded"
          >
            <X size={14} aria-hidden="true" />
            {t('clearSearch')}
          </button>
        ) : null}
      </div>

      {/* ── Mobile row renderer ──────────────────────────────────────────── */}
      {mobileRow ? (
        <div className="md:hidden">
          {visible.length === 0 ? (
            noMatchContent ?? (
              <div className="rounded-lg border border-dashed border-border bg-surface px-6 py-10 text-center">
                <p className="text-sm text-muted-foreground">{noMatchMessage ?? t('noMatches')}</p>
                {hasSearch ? (
                  <div className="mt-4">
                    <Button variant="outline" size="sm" onClick={() => { setSearch(''); setPage(1); }}>
                      {clearFiltersLabel ?? t('clearSearch')}
                    </Button>
                  </div>
                ) : null}
              </div>
            )
          ) : (
            <ul className="space-y-2" aria-label={label}>
              {visible.map((row) => (
                <li key={rowKey(row)}>{mobileRow(row, renderCtx)}</li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <TableScroll
        aria-label={label}
        className={mobileRow ? 'hidden md:block' : undefined}
      >
        <Table>
          <TableHeader>
            <TableRow>
              {/* Selection checkbox header */}
              {hasSelection && selection ? (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all"
                    checked={
                      visible.length > 0 &&
                      visible.every((row) => selection.selected.has(rowKey(row)))
                    }
                    // Some but not all: without this the header reads "nothing selected"
                    // while rows below it are ticked.
                    indeterminate={
                      visible.some((row) => selection.selected.has(rowKey(row))) &&
                      !visible.every((row) => selection.selected.has(rowKey(row)))
                    }
                    onChange={(e) => selection.onSelectAll(e.target.checked)}
                  />
                </TableHead>
              ) : null}

              {visibleColumns.map((col) => (
                <TableHead
                  key={col.key}
                  numeric={col.numeric}
                  aria-sort={col.sortable ? ariaSort(col.key) : undefined}
                  className={cn(
                    col.sticky &&
                      'sticky start-0 z-10 bg-surface-subtle shadow-[1px_0_0_0] shadow-border',
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
                      onClick={() => { setSort((prev) => nextSort(prev, col.key)); setPage(1); }}
                    >
                      <span>{col.header}</span>
                      <SortIcon direction={sort?.key === col.key ? sort.direction : null} />
                    </button>
                  ) : (
                    col.header
                  )}
                </TableHead>
              ))}

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
                {noMatchContent ?? (
                  <>
                    <p>{noMatchMessage ?? t('noMatches')}</p>
                    {hasSearch ? (
                      <div className="mt-4">
                        <Button variant="outline" size="sm" onClick={() => { setSearch(''); setPage(1); }}>
                          {clearFiltersLabel ?? t('clearSearch')}
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </TableEmpty>
            ) : (
              visible.map((row) => (
                <TableRow key={rowKey(row)}>
                  {/* Selection checkbox cell */}
                  {hasSelection && selection ? (
                    <TableCell className="w-10">
                      <Checkbox
                        aria-label={`Select ${rowKey(row)}`}
                        checked={selection.selected.has(rowKey(row))}
                        onChange={(e) => selection.onSelect(rowKey(row), e.target.checked)}
                      />
                    </TableCell>
                  ) : null}

                  {visibleColumns.map((col) => (
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
                    <TableCell className="w-10 text-end">{rowActions!(row)}</TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableScroll>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      {paginationConfig && sorted.length > 0 ? (
        <PaginationBar
          page={safePage}
          totalPages={totalPages}
          from={from}
          to={to}
          count={sorted.length}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageChange={setPage}
          onPageSizeChange={handlePageSizeChange}
        />
      ) : null}
    </div>
  );
}
