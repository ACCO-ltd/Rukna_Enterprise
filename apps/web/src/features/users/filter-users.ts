import type { UserWithRolesResponse } from '@erp/types';
import { UserStatus } from '@erp/types';

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
