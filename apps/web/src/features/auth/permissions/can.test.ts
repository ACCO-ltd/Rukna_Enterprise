import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { sessionStore } from '../session/session-store';
import type { AuthenticatedUser } from '../session/session-store';
import { can, hasRole, usePermissions } from './can';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'engineer@acco.rukna.app',
    orgId: 'org-1',
    tenantSlug: 'acco',
    roles: ['site-engineer'],
    permissions: ['view:project'],
    lang: 'en',
    ...overrides,
  };
}

function setSession(overrides: Partial<AuthenticatedUser> = {}) {
  sessionStore.setSession({ accessToken: 'fake.header.sig', user: makeUser(overrides) });
}

// ─── can() — non-reactive ─────────────────────────────────────────────────────

describe('can()', () => {
  beforeEach(() => sessionStore.clearSession());

  it('returns true for any permission while PERMISSIONS_ENFORCED is false', () => {
    // No session — still returns true because enforcement is off
    expect(can('create:project')).toBe(true);
    expect(can('manage:user')).toBe(true);
    expect(can('approve:contract')).toBe(true);
  });

  it('returns true even when the user has no matching permission (not enforced)', () => {
    setSession({ permissions: [] });
    expect(can('manage:user')).toBe(true);
  });
});

// ─── hasRole() — non-reactive ─────────────────────────────────────────────────

describe('hasRole()', () => {
  beforeEach(() => sessionStore.clearSession());

  it('returns false when no session exists', () => {
    expect(hasRole('admin')).toBe(false);
  });

  it('returns true for a role the user holds', () => {
    setSession({ roles: ['admin', 'site-engineer'] });
    expect(hasRole('admin')).toBe(true);
    expect(hasRole('site-engineer')).toBe(true);
  });

  it('returns false for a role the user does not hold', () => {
    setSession({ roles: ['site-engineer'] });
    expect(hasRole('admin')).toBe(false);
    expect(hasRole('financial-officer')).toBe(false);
  });

  it('is case-sensitive', () => {
    setSession({ roles: ['Admin'] });
    expect(hasRole('admin')).toBe(false);
    expect(hasRole('Admin')).toBe(true);
  });
});

// ─── usePermissions() hook ────────────────────────────────────────────────────

describe('usePermissions()', () => {
  beforeEach(() => sessionStore.clearSession());

  it('renders without error with no active session', () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can).toBeTypeOf('function');
    expect(result.current.canAny).toBeTypeOf('function');
    expect(result.current.moduleVisible).toBeTypeOf('function');
  });

  it('returns true for can() while PERMISSIONS_ENFORCED is false', () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.can('create:project')).toBe(true);
    expect(result.current.can('approve:contract')).toBe(true);
  });

  it('returns true for canAny() including an empty array while not enforced', () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.canAny(['create:project', 'manage:user'])).toBe(true);
    // canAny on an empty array: no permissions to satisfy → false even unenforced
    // because some([]) is false — this is intentional caller behaviour
    expect(result.current.canAny([])).toBe(false);
  });

  it('returns true for all known modules while PERMISSIONS_ENFORCED is false', () => {
    const { result } = renderHook(() => usePermissions());
    for (const module of ['portfolio', 'finance', 'operations', 'reports', 'administration']) {
      expect(result.current.moduleVisible(module)).toBe(true);
    }
  });

  it('returns true for an unknown module while PERMISSIONS_ENFORCED is false', () => {
    const { result } = renderHook(() => usePermissions());
    expect(result.current.moduleVisible('inventory')).toBe(true);
  });

  it('re-renders when the session is set (login)', () => {
    const renders: number[] = [];
    const { result } = renderHook(() => {
      renders.push(1);
      return usePermissions();
    });

    const renderCountBefore = renders.length;

    act(() => {
      setSession({ permissions: ['view:project'] });
    });

    expect(renders.length).toBeGreaterThan(renderCountBefore);
    expect(result.current.can('view:project')).toBe(true);
  });

  it('re-renders when the session is cleared (logout)', () => {
    setSession({ permissions: ['view:project'] });

    const renders: number[] = [];
    const { result } = renderHook(() => {
      renders.push(1);
      return usePermissions();
    });

    const renderCountBefore = renders.length;

    act(() => {
      sessionStore.clearSession();
    });

    expect(renders.length).toBeGreaterThan(renderCountBefore);
    // Still true because PERMISSIONS_ENFORCED=false
    expect(result.current.can('view:project')).toBe(true);
  });

  it('unsubscribes from the store on unmount (no memory leak)', () => {
    const { unmount } = renderHook(() => usePermissions());
    unmount();
    // After unmount, store updates should not throw
    expect(() => {
      act(() => setSession());
      act(() => sessionStore.clearSession());
    }).not.toThrow();
  });
});
