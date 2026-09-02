import type { ProjectCategory, ProjectStatus } from '@erp/types';

import type { Project } from './types';

/** `'UNTYPED'` selects legacy projects that carry no category; `'ALL'` disables the filter. */
export type CategoryFilter = ProjectCategory | 'UNTYPED' | 'ALL';

export interface ProjectFilters {
  search: string;
  status: ProjectStatus | 'ALL';
  category?: CategoryFilter;
}

/**
 * Filters the project list in the browser.
 *
 * `GET /projects` accepts a `status` parameter but offers no search and no pagination
 * (B8), and the whole list is already cached for the dashboard. Filtering the cached array
 * keeps status counts and the list consistent with each other and avoids a request per
 * keystroke. This is a scale trade-off, not an oversight: past a few hundred projects it
 * needs to move server-side.
 *
 * Search matches code, both names and client, so an Arabic-named project is findable while
 * the UI is in English and vice versa.
 */
export function filterProjects(projects: Project[], filters: ProjectFilters): Project[] {
  const needle = filters.search.trim().toLowerCase();

  const category = filters.category ?? 'ALL';

  return projects.filter((project) => {
    if (filters.status !== 'ALL' && project.status !== filters.status) return false;
    // Category filter: 'UNTYPED' matches legacy projects with no category; a specific category
    // matches exactly. 'ALL' (default) does not constrain.
    if (category === 'UNTYPED' && project.category) return false;
    if (category !== 'ALL' && category !== 'UNTYPED' && project.category !== category) return false;
    if (!needle) return true;

    return [project.code, project.name, project.clientName].some(
      (field) => field?.toLowerCase().includes(needle),
    );
  });
}
