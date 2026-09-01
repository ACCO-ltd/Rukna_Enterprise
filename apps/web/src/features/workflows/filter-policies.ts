import type { ApprovalPolicySummary } from './api/workflows-api';

/** Status filter values: every status, or one of the lifecycle states an admin narrows to. */
export type PolicyStatusFilter = 'ALL' | ApprovalPolicySummary['status'];

/**
 * Pure, in-memory filter over the fetched approval-policy list. Search matches the `policyKey`
 * (case-insensitive); status narrows to one lifecycle state. Kept out of the component so the
 * matching rules can be asserted without rendering — the list is fetch-everything (design §10
 * open-question 4), so filtering a few dozen rows in memory is cheap. Mirrors `filterUsers` /
 * `filterRoles`.
 */
export function filterPolicies(
  policies: ApprovalPolicySummary[],
  query: string,
  status: PolicyStatusFilter,
): ApprovalPolicySummary[] {
  const q = query.trim().toLocaleLowerCase();
  return policies.filter((policy) => {
    if (status !== 'ALL' && policy.status !== status) return false;
    if (!q) return true;
    return policy.policyKey.toLocaleLowerCase().includes(q);
  });
}
