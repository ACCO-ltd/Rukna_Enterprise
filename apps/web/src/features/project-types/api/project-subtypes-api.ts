import type { ProjectCategory } from '@erp/types';

import { apiClient } from '@/lib/api-client';
import type { ProjectSubtype } from '@/lib/api-types';

export type { ProjectSubtype } from '@/lib/api-types';

/**
 * `GET /project-subtypes` — the subtype registry, mirroring the District registry.
 *
 * Reads are open to anyone who can view projects (the create/edit-project form needs the
 * picker). Pass `category` to scope the picker to the chosen category, and `activeOnly` to
 * hide deactivated rows from new-project pickers. The Settings manager passes neither so it
 * can show inactive rows too.
 */
export function listProjectSubtypes(
  category?: ProjectCategory,
  activeOnly = false,
): Promise<ProjectSubtype[]> {
  const params: Record<string, string> = {};
  if (category) params.category = category;
  if (activeOnly) params.activeOnly = 'true';

  return apiClient<ProjectSubtype[]>('/project-subtypes', {
    ...(Object.keys(params).length > 0 ? { params } : {}),
  });
}

/**
 * `POST /project-subtypes` — requires `manage:project-type`. The (category, name) pair is
 * unique per organization; a duplicate name-in-category is a 409.
 */
export function createProjectSubtype(payload: {
  category: ProjectCategory;
  name: string;
}): Promise<ProjectSubtype> {
  return apiClient<ProjectSubtype>('/project-subtypes', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/**
 * `POST /project-subtypes/:id/deactivate` — requires `manage:project-type`. Hides the subtype
 * from new-project pickers while keeping the projects already classified under it. Returns the
 * row with `status: 'INACTIVE'`. There is no reactivate and no delete (mirrors the registry's
 * soft-lifecycle: a classification value that history references is never destroyed).
 */
export function deactivateProjectSubtype(id: string): Promise<ProjectSubtype> {
  return apiClient<ProjectSubtype>(`/project-subtypes/${id}/deactivate`, {
    method: 'POST',
  });
}
