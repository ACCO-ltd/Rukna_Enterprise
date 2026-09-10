import { PERMISSIONS, type RequestIdentity } from '@erp/types';

import { resolveBoqVisibility, canEditBoq } from './boq-visibility.policy.js';

/**
 * ADR-029 §8 A-1/A-2 — the single, DB-free definition of BOQ money visibility and edit authority.
 *
 * These prove the tier algebra in one place: operational sees no money, cost sees budgets but not
 * margin, margin sees all, and the umbrellas (`manage:boq`, legacy `financialPositionView`) map on
 * exactly as specified. No database, no Nest — just the pure policy.
 */

function identity(...permissions: string[]): RequestIdentity {
  return {
    userId: 'u1',
    activeOrganizationId: 'org-1',
    tenantSlug: 'acco',
    roles: [],
    permissions,
  };
}

describe('resolveBoqVisibility (ADR-029 A-2 tiers)', () => {
  it('operational tier (view:boq only) sees no money', () => {
    const v = resolveBoqVisibility(identity(PERMISSIONS.boqView));
    expect(v.canViewCost).toBe(false);
    expect(v.canViewMargin).toBe(false);
  });

  it('a caller with no BOQ permissions at all sees no money', () => {
    const v = resolveBoqVisibility(identity());
    expect(v.canViewCost).toBe(false);
    expect(v.canViewMargin).toBe(false);
  });

  it('cost tier (view-cost:boq) sees cost but NOT margin', () => {
    const v = resolveBoqVisibility(identity(PERMISSIONS.boqView, PERMISSIONS.boqViewCost));
    expect(v.canViewCost).toBe(true);
    expect(v.canViewMargin).toBe(false);
  });

  it('margin tier (view-margin:boq) sees all — margin implies cost', () => {
    const v = resolveBoqVisibility(identity(PERMISSIONS.boqView, PERMISSIONS.boqViewMargin));
    expect(v.canViewCost).toBe(true);
    expect(v.canViewMargin).toBe(true);
  });

  it('the manage:boq umbrella grants cost (a manager edits cost) but NOT margin', () => {
    const v = resolveBoqVisibility(identity(PERMISSIONS.boqManage));
    expect(v.canViewCost).toBe(true);
    expect(v.canViewMargin).toBe(false);
  });

  it('the legacy financialPositionView gate is carried onto both tiers (backward compat)', () => {
    const v = resolveBoqVisibility(identity(PERMISSIONS.financialPositionView));
    expect(v.canViewCost).toBe(true);
    expect(v.canViewMargin).toBe(true);
  });
});

describe('canEditBoq (ADR-029 A-1 umbrella)', () => {
  it('is allowed by edit-scope:boq alone', () => {
    expect(canEditBoq(identity(PERMISSIONS.boqEditScope))).toBe(true);
  });

  it('is allowed by edit-cost:boq alone', () => {
    expect(canEditBoq(identity(PERMISSIONS.boqEditCost))).toBe(true);
  });

  it('is allowed by the backward-compatible manage:boq umbrella', () => {
    expect(canEditBoq(identity(PERMISSIONS.boqManage))).toBe(true);
  });

  it('is denied to a view-only caller (no edit cap, no umbrella)', () => {
    expect(canEditBoq(identity(PERMISSIONS.boqView, PERMISSIONS.boqViewMargin))).toBe(false);
  });
});
