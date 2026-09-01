import { describe, expect, it } from 'vitest';

import type { ApprovalPolicySummary } from './api/workflows-api';
import { filterPolicies } from './filter-policies';

function policy(
  overrides: Partial<ApprovalPolicySummary> & { id: string },
): ApprovalPolicySummary {
  return {
    policyKey: 'PURCHASE_ORDER_APPROVAL',
    version: 1,
    status: 'DRAFT',
    effectiveFrom: null,
    effectiveTo: null,
    amountBasis: 'PO_TOTAL',
    notes: null,
    ruleCount: 0,
    updatedAt: '2026-08-30T00:00:00.000Z',
    ...overrides,
  };
}

describe('filterPolicies', () => {
  it('returns everything when nothing is filtered', () => {
    const policies = [policy({ id: 'a' }), policy({ id: 'b' })];
    expect(filterPolicies(policies, '', 'ALL')).toHaveLength(2);
  });

  it('filters by status', () => {
    const policies = [
      policy({ id: 'a', status: 'DRAFT' }),
      policy({ id: 'b', status: 'ACTIVE' }),
    ];
    expect(filterPolicies(policies, '', 'ACTIVE')).toEqual([policies[1]]);
  });

  it('matches the policy key, case-insensitively', () => {
    const policies = [
      policy({ id: 'a', policyKey: 'PURCHASE_ORDER_APPROVAL' }),
      policy({ id: 'b', policyKey: 'INVOICE_APPROVAL' }),
    ];
    expect(filterPolicies(policies, 'purchase', 'ALL')).toEqual([policies[0]]);
    expect(filterPolicies(policies, 'INVOICE', 'ALL')).toEqual([policies[1]]);
    expect(filterPolicies(policies, 'approval', 'ALL')).toHaveLength(2);
  });

  it('combines search and status', () => {
    const policies = [
      policy({ id: 'a', policyKey: 'PO_APPROVAL', status: 'DRAFT' }),
      policy({ id: 'b', policyKey: 'PO_APPROVAL', status: 'ACTIVE' }),
    ];
    expect(filterPolicies(policies, 'po', 'ACTIVE')).toEqual([policies[1]]);
  });

  it('yields nothing when no policy matches the search', () => {
    const policies = [policy({ id: 'a', policyKey: 'PO_APPROVAL' })];
    expect(filterPolicies(policies, 'nonexistent', 'ALL')).toEqual([]);
  });
});
