import { describe, expect, it } from 'vitest';

import { commercialTabsFor, commercialTabHref } from './commercial-nav';

/**
 * The billing model chooses ONE of two mutually-exclusive views in the same slot
 * (commercial-billing-model-refinement §4.1): a MILESTONE contract bills from its Payment Schedule,
 * everything else bills through Applications & Certification. The workspace route guard and the
 * switcher both derive their tabs from this one function, so a regression here would let a user
 * deep-link into a tab the contract does not have.
 */
describe('commercialTabsFor — Payment Schedule vs Applications (§4.1)', () => {
  it('shows Payment Schedule (not Applications) for a MILESTONE contract', () => {
    const tabs = commercialTabsFor('MILESTONE');

    expect(tabs).toContain('payment-schedule');
    expect(tabs).not.toContain('applications');
  });

  it('inserts Payment Schedule in the slot Applications occupies for a measured contract', () => {
    // Same ordinal position: after Contract & Security, before Variations.
    expect(commercialTabsFor('MILESTONE')).toEqual([
      'overview',
      'contract-security',
      'payment-schedule',
      'variations',
      'billing-collection',
    ]);
    expect(commercialTabsFor('MEASURED_IPC')).toEqual([
      'overview',
      'contract-security',
      'applications',
      'variations',
      'billing-collection',
    ]);
  });

  it('shows Applications (not Payment Schedule) for a MEASURED_IPC contract', () => {
    const tabs = commercialTabsFor('MEASURED_IPC');

    expect(tabs).toContain('applications');
    expect(tabs).not.toContain('payment-schedule');
  });

  it('falls back to Applications when the billing model is unknown (null / loading)', () => {
    for (const model of [null, undefined] as const) {
      const tabs = commercialTabsFor(model);
      expect(tabs).toContain('applications');
      expect(tabs).not.toContain('payment-schedule');
    }
  });

  it('routes the Payment Schedule tab to its own path', () => {
    expect(commercialTabHref('p-1', 'payment-schedule')).toBe(
      '/projects/p-1/commercial/payment-schedule',
    );
  });
});
