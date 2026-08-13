import { describe, expect, it } from 'vitest';

import { isActiveNavItem, NAV_DOMAINS, STANDALONE_NAV } from './nav-groups';

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

    it('exposes the five live workflow screens', () => {
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

    it('gates the four catalog setup items behind manage:procurement-config', () => {
      const configItems = procurement().items.filter((i) => i.permissionKey);
      expect(configItems.every((i) => i.permissionKey === 'manage:procurement-config')).toBe(true);
      const configHrefs = configItems.map((i) => i.href);
      expect(configHrefs).toContain('/procurement/setup/materials');
      expect(configHrefs).toContain('/procurement/setup/material-categories');
      expect(configHrefs).toContain('/procurement/setup/uom');
      expect(configHrefs).toContain('/procurement/setup/spend-categories');
    });

    it('keeps workflow screens ungated (no permissionKey)', () => {
      const workflowItems = procurement().items.filter((i) => !i.permissionKey);
      const hrefs = workflowItems.map((i) => i.href);
      expect(hrefs).toContain('/procurement/suppliers');
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

  describe('administration domain', () => {
    const admin = () => NAV_DOMAINS.find((d) => d.moduleKey === 'administration')!;

    it('contains users, roles, workflows and audit-logs', () => {
      const hrefs = admin().items.map((i) => i.href);
      expect(hrefs).toContain('/admin/users');
      expect(hrefs).toContain('/admin/roles');
      expect(hrefs).toContain('/admin/workflows');
      expect(hrefs).toContain('/admin/audit-logs');
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
