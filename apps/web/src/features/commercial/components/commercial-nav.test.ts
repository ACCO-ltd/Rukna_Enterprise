import { describe, expect, it } from 'vitest';

import { commercialLandingTab, commercialTabsFor, commercialTabHref } from './commercial-nav';

/**
 * ADR-030 CONST-COM-026 (S-SH-1): the workspace is four tabs, Overview retired. The billing model
 * chooses ONE of two mutually-exclusive views in the same slot — a MILESTONE contract bills from its
 * Payment Schedule, everything else bills through Applications & Certification. The route guard and
 * the switcher both derive their tabs from this one function, so a regression here would let a user
 * deep-link into a tab the contract does not have.
 */
describe('commercialTabsFor — four tabs, no Overview (S-SH-1)', () => {
  it('returns exactly Contract · Payment Schedule · Variations · Billing for MILESTONE', () => {
    expect(commercialTabsFor('MILESTONE')).toEqual([
      'contract-security',
      'payment-schedule',
      'variations',
      'billing-collection',
    ]);
  });

  it('keeps Applications in the payment-schedule slot for a measured contract', () => {
    expect(commercialTabsFor('MEASURED_IPC')).toEqual([
      'contract-security',
      'applications',
      'variations',
      'billing-collection',
    ]);
  });

  it('never includes the retired Overview tab', () => {
    for (const model of ['MILESTONE', 'MEASURED_IPC', null, undefined] as const) {
      expect(commercialTabsFor(model)).not.toContain('overview');
      expect(commercialTabsFor(model)).toHaveLength(4);
    }
  });

  it('shows Payment Schedule (not Applications) for a MILESTONE contract', () => {
    const tabs = commercialTabsFor('MILESTONE');
    expect(tabs).toContain('payment-schedule');
    expect(tabs).not.toContain('applications');
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

/**
 * With Overview gone, the workspace lands on Payment Schedule for a MILESTONE contract (the
 * operational home) and Contract otherwise. When there is no contract yet, Contract is the only
 * meaningful destination whatever the (absent) billing model.
 */
describe('commercialLandingTab — where the workspace opens (S-SH-1)', () => {
  it('lands on Payment Schedule for a MILESTONE contract', () => {
    expect(commercialLandingTab('MILESTONE', true)).toBe('payment-schedule');
  });

  it('lands on Contract for a measured contract', () => {
    expect(commercialLandingTab('MEASURED_IPC', true)).toBe('contract-security');
  });

  it('lands on Contract when there is no contract yet, whatever the billing model', () => {
    expect(commercialLandingTab('MILESTONE', false)).toBe('contract-security');
    expect(commercialLandingTab(null, false)).toBe('contract-security');
  });
});
