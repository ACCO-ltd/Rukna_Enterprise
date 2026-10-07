'use client';

import { useEffect, useState } from 'react';

import { sortRows, type GridColumn, type ServerListConfig, type SortState } from '@/components/platform-data-grid';

const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

/**
 * Search on the server, sort and paging in the browser — for the procurement lists, whose
 * endpoints take `search` but return the whole matching set.
 *
 * The grid runs in server mode so its search box drives the API's `search` (debounced) instead
 * of filtering the fetched rows again by what is on screen — the server matches fields the
 * columns do not show. Sorting and paging the returned set stay local.
 */
export function useListControls(defaultPageSize = 25) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);

  function view<T>(rows: T[], columns: GridColumn<T>[]): { data: T[]; server: ServerListConfig } {
    const sorted = sortRows(rows, sort, columns);
    const lastPage = Math.max(1, Math.ceil(sorted.length / pageSize));
    const current = Math.min(page, lastPage);
    const start = (current - 1) * pageSize;
    return {
      data: sorted.slice(start, start + pageSize),
      server: {
        search,
        onSearchChange: (next) => {
          setSearch(next);
          setPage(1);
        },
        sort,
        onSortChange: (next) => {
          setSort(next);
          setPage(1);
        },
        page: current,
        pageSize,
        total: sorted.length,
        onPageChange: setPage,
        onPageSizeChange: (next) => {
          setPageSize(next);
          setPage(1);
        },
      },
    };
  }

  return {
    /** The search as typed — non-empty means the list is narrowed. */
    search: search.trim(),
    /** The search to send to the API. */
    debouncedSearch: debouncedSearch || undefined,
    resetPage: () => setPage(1),
    view,
  };
}
