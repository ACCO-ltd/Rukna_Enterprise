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
      'accounting',
      'procurement',
      'operations',
      'reports',
      'administration',
    ]);
  });

  it('marks future modules as disabled so they render without linking', () => {
    const allItems = NAV_GROUPS.flatMap((g) => g.items);
    const disabled = allItems.filter((i) => i.disabled).map((i) => i.href);
    expect(disabled).toContain('/finance/cash-position');
    expect(disabled).toContain('/operations/inventory');
    expect(disabled).toContain('/admin/exchange-rates');
  });

  it('no longer carries the /operations/procurement placeholder it replaced', () => {
    const allHrefs = NAV_GROUPS.flatMap((g) => [
      ...g.items,
      ...(g.subGroups?.flatMap((s) => s.items) ?? []),
    ]).map((i) => i.href);

    expect(allHrefs).not.toContain('/operations/procurement');
  });

  it('enabled finance item is receipts (live endpoint)', () => {
    const finance = NAV_GROUPS.find((g) => g.moduleKey === 'finance')!;
    const enabled = finance.items.filter((i) => !i.disabled);
    expect(enabled.map((i) => i.href)).toEqual(['/receipts']);
  });

  describe('accounting', () => {
    const accounting = () => NAV_GROUPS.find((g) => g.moduleKey === 'accounting')!;

    it('enables every Sprint 4 screen', () => {
      const enabled = accounting()
        .items.filter((i) => !i.disabled)
        .map((i) => i.href);

      expect(enabled).toEqual([
        '/finance/accounting/chart-of-accounts',
        '/finance/accounting/periods',
        // Bootstrap tier 3. Sits with the other setup screens rather than with entry or
        // reporting: a payment cannot name a bank until one is configured.
        '/finance/accounting/bank-accounts',
        // Bootstrap tier 4, last of the setup screens: the migration is the cutover, so it
        // follows the chart, the periods and the banks it depends on.
        '/finance/accounting/opening-balance',
        '/finance/accounting/journals',
        '/finance/accounting/trial-balance',
        '/finance/accounting/profit-loss',
        '/finance/accounting/balance-sheet',
        '/finance/accounting/monthly-comparison',
        '/finance/accounting/ledger',
        // AR. Added once the /receipts collision was traced: it only ever affected customer
        // receipts, and this controller has always been mounted at /invoices.
        '/finance/accounting/invoices',
        '/finance/accounting/bills',
        '/finance/accounting/payments',
      ]);
    });

    /**
     * Sprint 4 disabled both AP screens on #26. That was over-cautious for bills — only
     * `POST /bills` needed a supplier — and it is now wrong for payments too: #26 was fixed
     * in `7cf2507`, and AP Tier C built the payment screens on top of it.
     *
     * Nothing in the accounting group is disabled any more. The assertion is kept, inverted,
     * because the previous version passed for a day after the blocker it described was gone.
     */
    it('leaves no accounting screen disabled', () => {
      expect(accounting().items.filter((i) => i.disabled)).toEqual([]);
    });

    it('lists setup before entry before reporting', () => {
      // The order a new organisation has to work in: nothing posts without a chart of
      // accounts and a period, and nothing reports until something is posted.
      const hrefs = accounting().items.map((i) => i.href);

      expect(hrefs.indexOf('/finance/accounting/chart-of-accounts')).toBeLessThan(
        hrefs.indexOf('/finance/accounting/journals'),
      );
      expect(hrefs.indexOf('/finance/accounting/journals')).toBeLessThan(
        hrefs.indexOf('/finance/accounting/trial-balance'),
      );
    });
  });

  describe('procurement', () => {
    const procurement = () => NAV_GROUPS.find((g) => g.moduleKey === 'procurement')!;

    it('sits directly after accounting, at the same level as Finance (§12.1)', () => {
      const keys = NAV_GROUPS.map((g) => g.moduleKey);
      expect(keys.indexOf('procurement')).toBe(keys.indexOf('accounting') + 1);
    });

    it('exposes the five live workflow screens, none disabled', () => {
      expect(procurement().items.map((i) => i.href)).toEqual([
        '/procurement/suppliers',
        '/procurement/requests',
        '/procurement/orders',
        '/procurement/grn',
        '/procurement/commitments',
      ]);
      expect(procurement().items.filter((i) => i.disabled)).toHaveLength(0);
    });

    /**
     * Suppliers is master data, but it is not in the Setup sub-group. Setup is collapsed by
     * default and gated on a single `manage:procurement-config` permission, justified there
     * as configuration "done once, while the other five are done daily". A supplier is added
     * whenever purchasing widens, and putting it behind that gate would stop a buyer holding
     * `create:purchase-order` from adding the supplier their own order needs.
     */
    it('keeps suppliers out of the collapsed Setup sub-group', () => {
      const setup = procurement().subGroups?.find((g) => g.labelKey === 'procurementSetup');
      expect(setup?.items.map((i) => i.href)).not.toContain('/procurement/suppliers');
      expect(procurement().items.map((i) => i.href)).toContain('/procurement/suppliers');
    });

    /**
     * §12.12's sidebar snippet lists a `/procurement/bill-matching` item, and §12.8 says
     * matching is reached from the supplier bill and explicitly "not as a standalone
     * list". §12.8 describes the screen, so §12.8 wins.
     */
    it('has no standalone bill-matching entry', () => {
      const hrefs = procurement().items.map((i) => i.href);
      expect(hrefs).not.toContain('/procurement/bill-matching');
    });

    /** §12.7 offers two routes; /procurement/grn cannot be confused with Sprint 3's /receipts. */
    it('routes goods receipts to /procurement/grn, away from client receipts', () => {
      const hrefs = procurement().items.map((i) => i.href);
      expect(hrefs).toContain('/procurement/grn');
      expect(hrefs).not.toContain('/procurement/receipts');
    });

    it('nests the four setup screens in a collapsed, permission-gated sub-group', () => {
      const setup = procurement().subGroups?.[0];

      expect(setup?.defaultCollapsed).toBe(true);
      expect(setup?.permissionKey).toBe('manage:procurement-config');
      expect(setup?.items.map((i) => i.href)).toEqual([
        '/procurement/setup/uom',
        '/procurement/setup/material-categories',
        '/procurement/setup/spend-categories',
        '/procurement/setup/materials',
      ]);
    });
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
