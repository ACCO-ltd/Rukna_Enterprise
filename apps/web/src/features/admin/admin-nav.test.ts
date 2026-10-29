import { describe, expect, it } from 'vitest';

import { ADMIN_TABS, isAdminDeepRoute, visibleAdminTabs } from './admin-nav';

describe('ADMIN_TABS', () => {
  it('is the nav model, not a copy of it', () => {
    expect(ADMIN_TABS.map((tab) => tab.href)).toEqual([
      '/admin/users',
      '/admin/roles',
      '/admin/roles/matrix',
      '/admin/districts',
      '/admin/project-subtypes',
      '/admin/branding',
      '/admin/templates',
      '/admin/photo-reader',
      '/admin/workflows',
      '/admin/audit-logs',
    ]);
  });
});

describe('isAdminDeepRoute', () => {
  it('is false on a tab itself', () => {
    for (const tab of ADMIN_TABS) {
      expect(isAdminDeepRoute(tab.href)).toBe(false);
    }
  });

  it('is false on the workspace root', () => {
    expect(isAdminDeepRoute('/admin')).toBe(false);
  });

  it('is true beneath a tab — the governance builder owns its own chrome', () => {
    expect(isAdminDeepRoute('/admin/workflows/PURCHASE_ORDER_APPROVAL')).toBe(true);
  });

  it('is written against the tab list, so a future deep route inherits the behaviour', () => {
    expect(isAdminDeepRoute('/admin/users/user-1')).toBe(true);
  });
});

describe('visibleAdminTabs', () => {
  it('drops the gated tabs when the permission is absent', () => {
    const tabs = visibleAdminTabs(() => false);
    expect(tabs.map((tab) => tab.href)).toEqual([
      '/admin/users',
      '/admin/roles',
      '/admin/workflows',
      '/admin/audit-logs',
    ]);
  });

  it('keeps every tab for a holder of all three org gates', () => {
    const held = new Set(['manage:district', 'manage:project-type', 'manage:organization']);
    expect(visibleAdminTabs((p) => held.has(p))).toHaveLength(9);
  });
});

describe('nested admin tabs (roles matrix)', () => {
  it('keeps the tab bar on a tab nested under another, and lights only the nested one', async () => {
    const { activeAdminTab, isAdminDeepRoute } = await import('./admin-nav');
    expect(isAdminDeepRoute('/admin/roles/matrix')).toBe(false);
    expect(activeAdminTab('/admin/roles/matrix')).toBe('/admin/roles/matrix');
    expect(activeAdminTab('/admin/roles')).toBe('/admin/roles');
    // The governance builder is still a deep route.
    expect(isAdminDeepRoute('/admin/workflows/pol-1')).toBe(true);
  });
});
