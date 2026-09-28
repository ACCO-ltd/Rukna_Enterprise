import { describe, expect, it } from 'vitest';

import { commercialLandingTab, commercialTabHref, commercialTabsFor } from './commercial-nav';

describe('commercialTabsFor', () => {
  it('gives a milestone contract Billing and Contract only', () => {
    expect(commercialTabsFor('MILESTONE')).toEqual(['billing', 'contract']);
    expect(commercialTabsFor(null)).toEqual(['billing', 'contract']);
  });

  it('adds Applications only for a measured (IPC) contract', () => {
    expect(commercialTabsFor('MEASURED_IPC')).toEqual(['billing', 'contract', 'applications']);
  });

  it('has no Overview view any more', () => {
    expect(commercialTabsFor('MILESTONE')).not.toContain('overview');
  });
});

describe('commercialLandingTab', () => {
  it('lands people who bill on Billing, everyone else on Contract', () => {
    expect(commercialLandingTab(true)).toBe('billing');
    expect(commercialLandingTab(false)).toBe('contract');
  });
});

describe('commercialTabHref', () => {
  it('uses the short, real URLs', () => {
    expect(commercialTabHref('p-1', 'billing')).toBe('/projects/p-1/commercial/billing');
    expect(commercialTabHref('p-1', 'contract')).toBe('/projects/p-1/commercial/contract');
  });
});
