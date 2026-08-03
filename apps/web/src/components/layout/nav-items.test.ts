import { describe, expect, it } from 'vitest';

import { isActiveNavItem, NAV_ITEMS } from './nav-items';

describe('NAV_ITEMS', () => {
  // Guards the decision in apps/web/CLAUDE.md: no navigation to endpoints that do not
  // exist. Procurement, Stock, Cost and DPRs have no API — if someone adds one of those
  // before the backend does, this fails.
  //
  // Clients joined the list when its screens shipped; Contracts and Receipts follow as
  // theirs do. IPA and IPC never appear here — they are reached through their contract,
  // not from the top-level menu.
  it('only lists destinations backed by live endpoints', () => {
    expect(NAV_ITEMS.map((item) => item.href)).toEqual(['/dashboard', '/projects', '/clients']);
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
