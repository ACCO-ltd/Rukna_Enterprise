import { describe, expect, it } from 'vitest';

import { NAV_DOMAINS } from './nav-groups';
import { moduleTabs, resolveModule } from './module-nav';

const allowAll = () => true;
const domain = (key: string) => NAV_DOMAINS.find((d) => d.moduleKey === key)!;

describe('resolveModule', () => {
  it('resolves a module page to its domain, item and group', () => {
    const r = resolveModule('/finance/accounting/bills');
    expect(r?.domain.moduleKey).toBe('accounting');
    expect(r?.item?.labelKey).toBe('supplierBills');
    expect(r?.groupKey).toBe('payables');
  });

  it('resolves detail routes under their list item', () => {
    expect(resolveModule('/finance/accounting/bills/abc-123')?.item?.labelKey).toBe('supplierBills');
    expect(resolveModule('/receipts/new')?.item?.labelKey).toBe('receipts');
  });

  it('ignores cross-links — Supplier bills belongs to Finance, not Procurement', () => {
    expect(resolveModule('/finance/accounting/bills')?.domain.moduleKey).toBe('accounting');
  });

  it('prefers the longest matching href', () => {
    expect(resolveModule('/procurement/setup/uom')?.item?.labelKey).toBe('unitsOfMeasure');
  });

  it('stands aside for the project workspace, which keeps its own tabs', () => {
    expect(resolveModule('/projects/p-1')).toBeNull();
    expect(resolveModule('/projects/p-1/boq')).toBeNull();
    expect(resolveModule('/projects')?.domain.moduleKey).toBe('portfolio');
    expect(resolveModule('/projects/new')?.domain.moduleKey).toBe('portfolio');
    expect(resolveModule('/clients')?.item?.labelKey).toBe('clients');
    expect(resolveModule('/clients/new')?.item?.labelKey).toBe('clients');
    expect(resolveModule('/clients/c-1/edit')?.item?.labelKey).toBe('clients');
  });

  it('stands aside for the client record, which carries its own breadcrumbs', () => {
    expect(resolveModule('/clients/c-1')).toBeNull();
  });

  it('returns null outside every module and for flat domains', () => {
    expect(resolveModule('/dashboard')).toBeNull();
    expect(resolveModule('/notifications')).toBeNull();
    expect(resolveModule('/admin/users')).toBeNull();
  });

  it('gives a module landing route its module', () => {
    const r = resolveModule('/accounting');
    expect(r?.domain.moduleKey).toBe('accounting');
    expect(r?.item).toBeUndefined();
  });
});

describe('moduleTabs', () => {
  it('turns groups into dropdown tabs in declared order', () => {
    const tabs = moduleTabs(domain('accounting'), '/finance/accounting/bills', allowAll);
    expect(tabs.map((t) => `${t.kind}:${t.key}`)).toEqual([
      // ADR-043 — Get started (the guided hub) and Projects (the portfolio) are ungrouped, so they
      // lead the tab bar; Banking sits between Payables and the ledger.
      'link:/finance/accounting/guide',
      'link:/finance/projects',
      'menu:receivables',
      'menu:payables',
      'menu:banking',
      'menu:ledger',
      'menu:reports',
      'menu:acctSetup',
    ]);
    const payables = tabs.find((t) => t.key === 'payables');
    expect(payables?.active).toBe(true);
    expect(payables?.kind === 'menu' && payables.items.find((i) => i.active)?.labelKey).toBe(
      'supplierBills',
    );
  });

  it('keeps ungrouped items as direct tabs', () => {
    const tabs = moduleTabs(domain('portfolio'), '/clients', allowAll);
    expect(tabs.map((t) => t.kind)).toEqual(['link', 'link']);
    expect(tabs.find((t) => t.active)?.key).toBe('/clients');
  });

  it('lays out the procurement tabs in flow order with Setup as the one dropdown', () => {
    const tabs = moduleTabs(domain('procurement'), '/procurement/requests', allowAll);
    expect(tabs.map((t) => t.labelKey)).toEqual([
      'materialRequests',
      'purchaseOrders',
      'goodsReceipts',
      'supplierBills',
      'buyerAdvances',
      'commitments',
      'suppliers',
      'group.setup',
    ]);
    const setup = tabs.find((t) => t.kind === 'menu');
    expect(setup?.kind === 'menu' && setup.items.map((i) => i.labelKey)).toEqual([
      'materials',
      'materialCategories',
      'unitsOfMeasure',
      'spendCategories',
    ]);
    expect(tabs.find((t) => t.active)?.key).toBe('/procurement/requests');
  });

  it('never marks a cross-link active', () => {
    const tabs = moduleTabs(domain('procurement'), '/finance/accounting/bills', allowAll);
    expect(tabs.some((t) => t.active)).toBe(false);
  });

  it('removes items the user cannot access, and empty groups with them', () => {
    const tabs = moduleTabs(domain('procurement'), '/procurement/orders', () => false);
    expect(tabs.some((t) => t.key === 'setup')).toBe(false);
    expect(tabs.find((t) => t.key === '/procurement/orders')?.active).toBe(true);
  });
});
