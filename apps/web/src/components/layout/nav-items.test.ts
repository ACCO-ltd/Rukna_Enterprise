import { describe, expect, it } from 'vitest';

import { isActiveNavItem, NAV_GROUPS, STANDALONE_NAV } from './nav-groups';

describe('STANDALONE_NAV', () => {
  it('contains only Dashboard as a standalone item', () => {
    expect(STANDALONE_NAV.map((i) => i.href)).toEqual(['/dashboard']);
  });
});

describe('NAV_GROUPS', () => {
  it('has the expected group keys in order', () => {
    expect(NAV_GROUPS.map((g) => g.moduleKey)).toEqual([
      'portfolio',
      'finance',
      'operations',
      'reports',
      'administration',
    ]);
  });

  it('marks future modules as disabled so they render without linking', () => {
    const allItems = NAV_GROUPS.flatMap((g) => g.items);
    const disabled = allItems.filter((i) => i.disabled).map((i) => i.href);
    expect(disabled).toContain('/finance/cash-position');
    expect(disabled).toContain('/operations/procurement');
    expect(disabled).toContain('/admin/exchange-rates');
  });

  it('enabled finance item is receipts (live endpoint)', () => {
    const finance = NAV_GROUPS.find((g) => g.moduleKey === 'finance')!;
    const enabled = finance.items.filter((i) => !i.disabled);
    expect(enabled.map((i) => i.href)).toEqual(['/receipts']);
  });

  it('portfolio items are all enabled (live endpoints exist)', () => {
    const portfolio = NAV_GROUPS.find((g) => g.moduleKey === 'portfolio')!;
    const disabled = portfolio.items.filter((i) => i.disabled);
    expect(disabled).toHaveLength(0);
  });
});

describe('isActiveNavItem', () => {
  it('matches dashboard only on exact path', () => {
    expect(isActiveNavItem('/dashboard', '/dashboard')).toBe(true);
    expect(isActiveNavItem('/dashboard/widgets', '/dashboard')).toBe(false);
  });

  it('matches a non-dashboard destination itself', () => {
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
    expect(isActiveNavItem('/receipts', '/projects')).toBe(false);
  });
});
