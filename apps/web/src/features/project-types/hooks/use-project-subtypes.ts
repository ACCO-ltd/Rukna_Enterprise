import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { ProjectCategory } from '@erp/types';

import {
  createProjectSubtype,
  deactivateProjectSubtype,
  listProjectSubtypes,
} from '../api/project-subtypes-api';

const subtypeKeys = {
  all: ['project-subtypes'] as const,
  list: (category: ProjectCategory | undefined, activeOnly: boolean) =>
    ['project-subtypes', { category: category ?? null, activeOnly }] as const,
};

/**
 * Lists subtypes for a category. Pass `activeOnly` for the project-form picker (which must not
 * offer a deactivated subtype); the Settings manager omits it to show inactive rows too.
 *
 * The query is disabled while `category` is undefined so the picker fires no request until a
 * category is chosen — a subtype is always scoped to exactly one category.
 */
export function useProjectSubtypes(
  category: ProjectCategory | undefined,
  activeOnly = false,
) {
  return useQuery({
    queryKey: subtypeKeys.list(category, activeOnly),
    queryFn: () => listProjectSubtypes(category, activeOnly),
    enabled: category !== undefined,
  });
}

export function useCreateProjectSubtype() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: { category: ProjectCategory; name: string }) =>
      createProjectSubtype(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: subtypeKeys.all }),
  });
}

export function useDeactivateProjectSubtype() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateProjectSubtype(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: subtypeKeys.all }),
  });
}
