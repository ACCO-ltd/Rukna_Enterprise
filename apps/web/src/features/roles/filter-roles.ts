import type { RoleSummary } from '@erp/types';

/** Kind filter values: every kind, or one of the two the API assigns. */
export type RoleKindFilter = 'ALL' | 'SYSTEM' | 'CUSTOM';

/**
 * Pure, in-memory filter over the fetched role list. Search matches the role name
 * (case-insensitive); kind narrows to SYSTEM or CUSTOM. Kept out of the component so the
 * matching rules can be asserted without rendering. There is deliberately no bulk selection
 * on roles — deletion is a single, consequence-heavy act — so this module has no selection
 * helper, unlike users.
 */
export function filterRoles(
  roles: RoleSummary[],
  query: string,
  kind: RoleKindFilter,
): RoleSummary[] {
  const q = query.trim().toLocaleLowerCase();
  return roles.filter((role) => {
    if (kind !== 'ALL' && role.kind !== kind) return false;
    if (!q) return true;
    return role.name.toLocaleLowerCase().includes(q);
  });
}
