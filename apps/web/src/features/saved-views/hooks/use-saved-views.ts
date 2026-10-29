import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SavedViewState, UpdateSavedViewInput } from '@erp/types';
import {
  createSavedView,
  deleteSavedView,
  listSavedViews,
  setSavedViewPublished,
  updateSavedView,
} from '../api/saved-views-api';

const keys = { list: (listKey: string) => ['saved-views', listKey] as const };

export function useSavedViews(listKey: string) {
  return useQuery({ queryKey: keys.list(listKey), queryFn: () => listSavedViews(listKey) });
}

/** Every write on a list's views refreshes that list's views. */
export function useSavedViewMutations(listKey: string) {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: keys.list(listKey) });
  const quiet = { flashRow: false as const };

  const create = useMutation({
    mutationFn: (input: { name: string; state: SavedViewState }) => createSavedView({ listKey, ...input }),
    onSuccess: refresh,
    meta: { successToast: 'common.views.saved', ...quiet },
  });
  const update = useMutation({
    mutationFn: ({ id, ...input }: UpdateSavedViewInput & { id: string }) => updateSavedView(id, input),
    onSuccess: refresh,
    meta: { successToast: 'common.views.updated', ...quiet },
  });
  const publish = useMutation({
    mutationFn: ({ id, published }: { id: string; published: boolean }) => setSavedViewPublished(id, published),
    onSuccess: refresh,
    meta: { successToast: 'common.views.sharingChanged', ...quiet },
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteSavedView(id),
    onSuccess: refresh,
    meta: { successToast: 'common.views.deleted', ...quiet },
  });
  return { create, update, publish, remove };
}
