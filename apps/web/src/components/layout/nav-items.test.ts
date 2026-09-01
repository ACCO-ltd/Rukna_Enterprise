import { describe, expect, it } from 'vitest';

import { groupNavItems, isActiveNavItem, NAV_DOMAINS, STANDALONE_NAV } from './nav-groups';

describe('STANDALONE_NAV', () => {
  it('contains only Dashboard as a standalone item', () => {
    expect(STANDALONE_NAV.map((i) => i.href)).toEqual(['/dashboard']);
  });
});

describe('NAV_DOMAINS', () => {
  it('has four domains in the correct order', () => {
    expect(NAV_DOMAINS.map((d) => d.moduleKey)).toEqual([
      'portfolio',
      'accounting',
      'procurement',
      'administration',
    ]);
  });

  it('every domain has a stable href (the domain entry route)', () => {
    for (const domain of NAV_DOMAINS) {
      expect(domain.href).toMatch(/^\//);
    }
  });

  describe('projects domain', () => {
    const projects = () => NAV_DOMAINS.find((d) => d.moduleKey === 'portfolio')!;

    it('contains clients and projects', () => {
      const hrefs = projects().items.map((i) => i.href);
      expect(hrefs).toContain('/clients');
      expect(hrefs).toContain('/projects');
    });

    it('has no disabled items', () => {
      expect(projects().items.filter((i) => i.disabled)).toHaveLength(0);
    });
  });

  describe('accounting domain', () => {
    const accounting = () => NAV_DOMAINS.find((d) => d.moduleKey === 'accounting')!;

    it('exposes the core accounting screens', () => {
      const hrefs = accounting().items.map((i) => i.href);
      expect(hrefs).toContain('/finance/accounting/chart-of-accounts');
      expect(hrefs).toContain('/finance/accounting/journals');
      expect(hrefs).toContain('/finance/accounting/invoices');
      expect(hrefs).toContain('/finance/accounting/bills');
      expect(hrefs).toContain('/finance/accounting/payments');
      expect(hrefs).toContain('/finance/accounting/ledger');
      expect(hrefs).toContain('/accounting/reports');
      expect(hrefs).toContain('/finance/accounting/periods');
      expect(hrefs).toContain('/receipts');
    });

    it('has no disabled items', () => {
      expect(accounting().items.filter((i) => i.disabled)).toHaveLength(0);
    });

    it('places setup screens before transaction screens', () => {
      const hrefs = accounting().items.map((i) => i.href);
      expect(hrefs.indexOf('/finance/accounting/chart-of-accounts')).toBeLessThan(
        hrefs.indexOf('/finance/accounting/journals'),
      );
    });
  });

  describe('procurement domain', () => {
    const procurement = () => NAV_DOMAINS.find((d) => d.moduleKey === 'procurement')!;

    it('exposes the live workflow screens', () => {
      const workflowHrefs = [
        '/procurement/suppliers',
        '/procurement/requests',
        '/procurement/orders',
        '/procurement/grn',
        '/procurement/commitments',
      ];
      const hrefs = procurement().items.map((i) => i.href);
      for (const href of workflowHrefs) {
        expect(hrefs).toContain(href);
      }
    });

    it('leads the operational spine with Purchase orders, then Material requests (A4)', () => {
      const operationalHrefs = procurement()
        .items.filter((i) => !i.groupKey)
        .map((i) => i.href);
      // Purchase orders is the primary entry — first, and ahead of Material requests.
      expect(operationalHrefs[0]).toBe('/procurement/orders');
      expect(operationalHrefs.indexOf('/procurement/orders')).toBeLessThan(
        operationalHrefs.indexOf('/procurement/requests'),
      );
    });

    it('cross-links Supplier bills to the canonical Accounting route, not a duplicate', () => {
      const bills = procurement().items.find((i) => i.labelKey === 'supplierBills');
      expect(bills).toBeDefined();
      expect(bills!.href).toBe('/finance/accounting/bills');
      expect(bills!.crossLink).toBe(true);
      // The route is not migrated: no procurement-owned bills path exists.
      expect(procurement().items.map((i) => i.href)).not.toContain('/procurement/bills');
    });

    it('keeps Payments out of Procurement — treasury stays in Accounting', () => {
      const hrefs = procurement().items.map((i) => i.href);
      expect(hrefs).not.toContain('/finance/accounting/payments');
      expect(hrefs.some((h) => h.includes('payment'))).toBe(false);
    });

    it('groups suppliers and the four catalogue screens under Setup', () => {
      const setup = procurement().items.filter((i) => i.groupKey === 'setup');
      const setupHrefs = setup.map((i) => i.href);
      expect(setupHrefs).toEqual([
        '/procurement/suppliers',
        '/procurement/setup/materials',
        '/procurement/setup/material-categories',
        '/procurement/setup/uom',
        '/procurement/setup/spend-categories',
      ]);
    });

    it('gates the four catalog setup items behind manage:procurement-config', () => {
      const configItems = procurement().items.filter((i) => i.permissionKey);
      expect(configItems.every((i) => i.permissionKey === 'manage:procurement-config')).toBe(true);
      const configHrefs = configItems.map((i) => i.href);
      expect(configHrefs).toContain('/procurement/setup/materials');
      expect(configHrefs).toContain('/procurement/setup/material-categories');
      expect(configHrefs).toContain('/procurement/setup/uom');
      expect(configHrefs).toContain('/procurement/setup/spend-categories');
    });

    it('keeps Suppliers ungated so a buyer can add the supplier their PO needs', () => {
      const suppliers = procurement().items.find((i) => i.href === '/procurement/suppliers');
      expect(suppliers?.permissionKey).toBeUndefined();
    });

    it('routes goods receipts to /procurement/grn, not /receipts', () => {
      const hrefs = procurement().items.map((i) => i.href);
      expect(hrefs).toContain('/procurement/grn');
      expect(hrefs).not.toContain('/procurement/receipts');
    });

    it('has no standalone bill-matching entry', () => {
      const hrefs = procurement().items.map((i) => i.href);
      expect(hrefs).not.toContain('/procurement/bill-matching');
    });
  });

  describe('groupNavItems', () => {
    it('leads with the ungrouped run, then each labelled group in order', () => {
      const groups = groupNavItems([
        { href: '/a', labelKey: 'a' },
        { href: '/b', labelKey: 'b' },
        { href: '/c', labelKey: 'c', groupKey: 'setup' },
        { href: '/d', labelKey: 'd', groupKey: 'setup' },
      ]);
      expect(groups).toHaveLength(2);
      expect(groups[0]!.key).toBeUndefined();
      expect(groups[0]!.items.map((i) => i.href)).toEqual(['/a', '/b']);
      expect(groups[1]!.key).toBe('setup');
      expect(groups[1]!.items.map((i) => i.href)).toEqual(['/c', '/d']);
    });

    it('groups the real procurement Setup section as one block', () => {
      const procurement = NAV_DOMAINS.find((d) => d.moduleKey === 'procurement')!;
      const groups = groupNavItems(procurement.items);
      const setup = groups.find((g) => g.key === 'setup');
      expect(setup?.items.map((i) => i.labelKey)).toEqual([
        'suppliers',
        'materials',
        'materialCategories',
        'unitsOfMeasure',
        'spendCategories',
      ]);
    });
  });

  describe('administration domain', () => {
    const admin = () => NAV_DOMAINS.find((d) => d.moduleKey === 'administration')!;

    it('contains users, roles, workflows and audit-logs', () => {
      const hrefs = admin().items.map((i) => i.href);
      expect(hrefs).toContain('/admin/users');
      expect(hrefs).toContain('/admin/roles');
      expect(hrefs).toContain('/admin/workflows');
      expect(hrefs).toContain('/admin/audit-logs');
    });

    it('groups every item into the four IA sections (no ungrouped run leads)', () => {
      const groups = groupNavItems(admin().items);
      // People → Organization → Approval governance → Evidence, in that order.
      expect(groups.map((g) => g.key)).toEqual([
        'people',
        'organization',
        'governance',
        'evidence',
      ]);
      // No undefined-keyed (ungrouped) run — the admin column is fully sectioned.
      expect(groups.some((g) => g.key === undefined)).toBe(false);
    });

    it('puts Users and Roles under People', () => {
      const groups = groupNavItems(admin().items);
      const people = groups.find((g) => g.key === 'people');
      expect(people?.items.map((i) => i.href)).toEqual(['/admin/users', '/admin/roles']);
    });

    it('puts Districts alone under Organization, keeping its manage:district gate', () => {
      const groups = groupNavItems(admin().items);
      const organization = groups.find((g) => g.key === 'organization');
      expect(organization?.items.map((i) => i.href)).toEqual(['/admin/districts']);
      expect(organization?.items[0]?.permissionKey).toBe('manage:district');
    });

    it('puts Policies/Workflows under Approval governance as a single entry (no duplicate deep route)', () => {
      const groups = groupNavItems(admin().items);
      const governance = groups.find((g) => g.key === 'governance');
      expect(governance?.items.map((i) => i.href)).toEqual(['/admin/workflows']);
      // The /admin/workflows/[policyId] builder is a row click, not a second nav row —
      // a duplicate would break isActiveNavItem's prefix match and highlight two rows.
      expect(admin().items.filter((i) => i.href.startsWith('/admin/workflows'))).toHaveLength(1);
    });

    it('puts Audit logs under Evidence', () => {
      const groups = groupNavItems(admin().items);
      const evidence = groups.find((g) => g.key === 'evidence');
      expect(evidence?.items.map((i) => i.href)).toEqual(['/admin/audit-logs']);
    });

    it('omits the DEFERRED Access reviews and standalone SoD rules items (no backend)', () => {
      const hrefs = admin().items.map((i) => i.href);
      expect(hrefs.some((h) => h.includes('access-review'))).toBe(false);
      expect(hrefs.some((h) => h.includes('sod'))).toBe(false);
    });
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
