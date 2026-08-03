import { describe, expect, it } from 'vitest';

import { isActiveNavItem, NAV_ITEMS } from './nav-items';

describe('NAV_ITEMS', () => {
  // Guards the decision in apps/web/CLAUDE.md: no navigation to endpoints that do not
  // exist. If someone adds Contracts or IPC before the API does, this fails.
  it('only lists destinations backed by live endpoints', () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(['/dashboard', '/projects']);
  });
});

describe('isActiveNavItem', () => {
  it('matches the destination itself', () => {
    expect(isActiveNavItem('/projects', '/projects')).toBe(true);
  });

  it('matches nested pages so the parent stays highlighted', () => {
    expect(isActiveNavItem('/projects/abc123', '/projects')).toBe(true);
    expect(isActiveNavItem('/projects/abc123/boq', '/projects')).toBe(true);
  });

  it('does not match a sibling route that merely shares a prefix', () => {
    expect(isActiveNavItem('/projects-archive', '/projects')).toBe(false);
  });

  it('does not match an unrelated route', () => {
    expect(isActiveNavItem('/dashboard', '/projects')).toBe(false);
  });
});
