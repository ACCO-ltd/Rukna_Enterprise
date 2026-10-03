import { describe, expect, it } from 'vitest';

import { COMMERCIAL_LANDING_TAB, commercialTabHref, commercialTabsFor } from './commercial-nav';

describe('commercialTabsFor', () => {
  it('gives a milestone contract Contract only — Billing moved to Finance (ADR-043 Phase 3)', () => {
    expect(commercialTabsFor('MILESTONE')).toEqual(['contract']);
    expect(commercialTabsFor(null)).toEqual(['contract']);
  });

  it('adds Applications only for a measured (IPC) contract', () => {
    expect(commercialTabsFor('MEASURED_IPC')).toEqual(['contract', 'applications']);
  });

  it('has no Overview or Billing view any more', () => {
    expect(commercialTabsFor('MILESTONE')).not.toContain('overview');
    expect(commercialTabsFor('MEASURED_IPC')).not.toContain('billing');
  });
});

describe('COMMERCIAL_LANDING_TAB', () => {
  it('lands everyone on Contract', () => {
    expect(COMMERCIAL_LANDING_TAB).toBe('contract');
  });
});

describe('commercialTabHref', () => {
  it('uses the short, real URLs', () => {
    expect(commercialTabHref('p-1', 'contract')).toBe('/projects/p-1/commercial/contract');
    expect(commercialTabHref('p-1', 'applications')).toBe('/projects/p-1/commercial/applications');
  });
});
