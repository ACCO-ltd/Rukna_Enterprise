'use client';

import { useState } from 'react';
import type { FilterValues } from '@erp/ui';
import type { SavedViewState } from '@erp/types';

import type { ListStateConfig, SortState } from '@/components/platform-data-grid';

/**
 * The search, filters and sort a list holds, in the shape saved views read and restore (Step 2a,
 * ADR-047). One hook so every list wires `PlatformDataGrid` (`listState`, `filterValues`) and
 * `ListViewsBar` (`current`, `onApply`) the same way.
 */
export function useListViewState(defaultSort: SortState | null, initialFilters: FilterValues = {}) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortState | null>(defaultSort);
  const [filters, setFilters] = useState<FilterValues>(initialFilters);

  const listState: ListStateConfig = { search, onSearchChange: setSearch, sort, onSortChange: setSort };
  const current: SavedViewState = { search, filters: filters as Record<string, string>, sort };
  const applyView = (state: SavedViewState) => {
    setSearch(state.search ?? '');
    setFilters({ ...(state.filters ?? {}) });
    setSort(state.sort ?? null);
  };

  return { search, sort, filters, setFilters, listState, current, applyView };
}
