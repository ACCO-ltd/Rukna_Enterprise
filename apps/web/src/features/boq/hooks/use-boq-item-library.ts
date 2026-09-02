'use client';

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';

import {
  createLibraryItem,
  recordLibraryUsage,
  searchLibraryItems,
  type BoqLibraryItem,
  type CreateLibraryItemPayload,
  type RecordLibraryUsagePayload,
} from '../api/boq-item-library-api';

/**
 * TanStack hooks over the BOQ item-library controller (ADR-020).
 *
 * The library is org-scoped, not project-scoped, so its cache key is a flat `['boq-library',
 * …]` rather than nested under a project. Search results are debounced by the caller and kept
 * briefly fresh: the catalogue changes rarely within a single BOQ-building session, and
 * re-querying on every keystroke-settled search would flicker the picker.
 */
export const boqLibraryKeys = {
  all: ['boq-library'] as const,
  search: (query: string) => [...boqLibraryKeys.all, 'search', query] as const,
};

/**
 * Searches the library. Disabled until `enabled` (the picker is open) so a closed drawer does
 * not fetch the catalogue. A blank query lists the top items, which is the useful default when
 * the picker first opens.
 */
export function useLibrarySearch(
  query: string,
  enabled: boolean,
): UseQueryResult<BoqLibraryItem[], Error> {
  return useQuery({
    queryKey: boqLibraryKeys.search(query.trim()),
    queryFn: () => searchLibraryItems(query),
    enabled,
    // The catalogue is stable within a building session; avoid refetching on every reopen.
    staleTime: 60_000,
  });
}

/**
 * Saves a manually-entered item to the library. Invalidates every cached search so the new
 * item appears immediately in the picker.
 */
export function useCreateLibraryItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateLibraryItemPayload) => createLibraryItem(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boqLibraryKeys.all }),
  });
}

/**
 * Records the rate a library item was just used at (assistance only).
 *
 * Deliberately fire-and-forget from the UI's perspective — recording usage is a side benefit
 * of adding an item, never a gate on it, so a failure here must not block or surface an error
 * on the add flow. The caller invokes it after the node is created and ignores the result.
 */
export function useRecordLibraryUsage() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { id: string; payload: RecordLibraryUsagePayload }) =>
      recordLibraryUsage(args.id, args.payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: boqLibraryKeys.all }),
  });
}
