'use client';

import { useEffect, useState } from 'react';
import type { FilterValues } from '@erp/ui';
import type { SavedViewState } from '@erp/types';

import type { ListStateConfig, SortState } from '@/components/platform-data-grid';

/**
 * The search, filters and sort a list holds, in the shape saved views read and restore (Step 2a,
 * ADR-047). One hook so every list wires `PlatformDataGrid` (`listState`, `filterValues`) and
 * `ListViewsBar` (`current`, `onApply`) the same way.
 *
 * `searchOnServer` (Step 8, the procurement lists): the search goes to the API as
 * `debouncedSearch` and the grid does not search the returned rows again. Filters, sort, groups,
 * paging and export stay in the browser.
 */
export function useListViewState(
  defaultSort: SortState | null,
  initialFilters: FilterValues = {},
  options: { searchOnServer?: boolean } = {},
) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(defaultSort);
  const [filters, setFilters] = useState<FilterValues>(initialFilters);
  const debouncedSearch = useDebounced(search.trim(), SEARCH_DEBOUNCE_MS);

  const listState: ListStateConfig = {
    search,
    onSearchChange: setSearch,
    sort,
    onSortChange: setSort,
    ...(options.searchOnServer ? { searchedUpstream: true } : {}),
  };
  const current: SavedViewState = { search, filters: filters as Record<string, string>, sort };
  const applyView = (state: SavedViewState) => {
    setSearch(state.search ?? '');
    setFilters({ ...(state.filters ?? {}) });
    setSort(state.sort ?? null);
  };

  return {
    search,
    /** With `searchOnServer`: the search to send to the API (debounced), or undefined. */
    debouncedSearch: debouncedSearch || undefined,
    sort,
    filters,
    setFilters,
    listState,
    current,
    applyView,
  };
}

const SEARCH_DEBOUNCE_MS = 300;

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
