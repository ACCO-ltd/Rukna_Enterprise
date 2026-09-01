import type { UserWithRolesResponse } from '@erp/types';
import { UserStatus } from '@erp/types';

/** Status filter values: every status, plus the two the tenant actually toggles between. */
export type UserStatusFilter = 'ALL' | UserStatus;

/**
 * Pure, in-memory filter over the fetched user list. Search matches name (first + last) or
 * email, case-insensitively; status narrows to one lifecycle state. Kept out of the component
 * so the matching rules can be asserted without rendering — search over a few hundred rows is
 * cheap and matches today's fetch-everything read model (design §10 open-question 4).
 */
export function filterUsers(
  users: UserWithRolesResponse[],
  query: string,
  status: UserStatusFilter,
): UserWithRolesResponse[] {
  const q = query.trim().toLocaleLowerCase();
  return users.filter((user) => {
    if (status !== 'ALL' && user.status !== status) return false;
    if (!q) return true;
    const haystack = `${user.firstName} ${user.lastName} ${user.email}`.toLocaleLowerCase();
    return haystack.includes(q);
  });
}

/**
 * The ids eligible for a bulk (de)activate over the current selection. The current user's own
 * row is always excluded from a *deactivate* run — the API rejects self-deactivation (400), so
 * offering it in bulk would half-apply the action and surface a confusing partial error.
 * Reactivation carries no such rule.
 *
 * `intent` is derived from the majority target state so a mixed selection resolves to a single
 * verb; callers pass the ids to run and the verb to label the confirm.
 */
export function bulkTargets(
  selected: UserWithRolesResponse[],
  intent: 'deactivate' | 'reactivate',
  currentUserId: string | null,
): string[] {
  if (intent === 'deactivate') {
    return selected
      .filter((user) => user.status === UserStatus.ACTIVE && user.id !== currentUserId)
      .map((user) => user.id);
  }
  return selected
    .filter((user) => user.status !== UserStatus.ACTIVE)
    .map((user) => user.id);
}
