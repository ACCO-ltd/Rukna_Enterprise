import type { ProjectRequirementRow } from '@erp/types';

/**
 * Requirement list filtering — pure, so the rules that decide what a user can find are testable
 * without a browser.
 *
 * **Approval and fulfilment are separate filters and never merge.** They answer different
 * questions — has this been agreed, and how much of it has been ordered — and a single "status"
 * filter would make "approved but nobody has ordered it", the most operationally urgent set on
 * the screen, unreachable.
 */
export interface RequirementFilters {
  search: string;
  approvalStatus: string;
  fulfillmentStatus: string;
  category: string;
  priority: string;
}

export const EMPTY_REQUIREMENT_FILTERS: RequirementFilters = {
  search: '',
  approvalStatus: '',
  fulfillmentStatus: '',
  category: '',
  priority: '',
};

/**
 * Search covers the MR number, the title and the description.
 *
 * All three because a reader looking for "rebar" may have typed it into any of them, and an MR
 * number is what somebody reads off a printed request.
 */
function matchesSearch(row: ProjectRequirementRow, term: string): boolean {
  const needle = term.trim().toLowerCase();
  if (!needle) return true;
  return [row.mrNumber, row.title, row.description]
    .filter((v): v is string => !!v)
    .some((v) => v.toLowerCase().includes(needle));
}

export function filterRequirements(
  rows: ProjectRequirementRow[],
  filters: RequirementFilters,
): ProjectRequirementRow[] {
  return rows.filter(
    (row) =>
      matchesSearch(row, filters.search) &&
      (!filters.approvalStatus || row.approvalStatus === filters.approvalStatus) &&
      (!filters.fulfillmentStatus || row.fulfillmentStatus === filters.fulfillmentStatus) &&
      (!filters.category || row.category === filters.category) &&
      (!filters.priority || row.priority === filters.priority),
  );
}

/**
 * The category options actually present in the data, rather than every category the organisation
 * has ever configured. A filter offering values that match nothing is a dead end.
 */
export function requirementCategoryOptions(rows: ProjectRequirementRow[]): string[] {
  return [...new Set(rows.map((r) => r.category).filter((v): v is string => !!v))].sort();
}

export function hasActiveFilters(filters: RequirementFilters): boolean {
  return (
    filters.search.trim() !== '' ||
    filters.approvalStatus !== '' ||
    filters.fulfillmentStatus !== '' ||
    filters.category !== '' ||
    filters.priority !== ''
  );
}
