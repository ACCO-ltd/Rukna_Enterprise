import { afterEach, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';

import { sessionStore } from '@/features/auth/session/session-store';

import { useProjectBillingHref } from './hooks';

function as(permissions: string[]) {
  sessionStore.setSession({
    accessToken: 't',
    user: { id: 'u', email: 'u@example.com', name: null, orgId: 'org-1', tenantSlug: 'test', roles: [], permissions },
  });
}

afterEach(() => sessionStore.clearSession());

describe('useProjectBillingHref (ADR-043 Phase 3 — no dead-end billing links)', () => {
  it('finance → Finance → Projects → Billing', () => {
    as(['view:contract', 'view:financial-position']);
    expect(renderHook(() => useProjectBillingHref('p1')).result.current).toBe('/finance/projects/p1/billing');
  });

  it('a Construction Director (view:contract only) → the Commercial schedule, never Finance', () => {
    as(['view:contract', 'manage:project']);
    expect(renderHook(() => useProjectBillingHref('p1')).result.current).toBe('/projects/p1/commercial/contract');
  });

  it('a money-blind role → no link', () => {
    as(['view:project']);
    expect(renderHook(() => useProjectBillingHref('p1')).result.current).toBeNull();
  });
});
