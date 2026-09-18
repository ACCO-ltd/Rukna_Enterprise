import { describe, expect, it } from 'vitest';

import { commercialLandingTab, commercialTabsFor, commercialTabHref } from './commercial-nav';

/**
 * Slice 8 — 3-tab consolidated navigation (ADR-030 CONST-COM-026, S-SH-1).
 *
 * Overview → Contract & Milestones → Billing & Collection for all billing models.
 * MEASURED_IPC substitutes Applications for Contract & Milestones (IPA/IPC chain retained).
 */
describe('commercialTabsFor — 3-tab consolidated layout (Slice 8)', () => {
  it('returns Overview first for a MILESTONE contract', () => {
    const tabs = commercialTabsFor('MILESTONE');
    expect(tabs[0]).toBe('overview');
  });

  it('returns Overview first for a measured contract', () => {
    const tabs = commercialTabsFor('MEASURED_IPC');
    expect(tabs[0]).toBe('overview');
  });

  it('returns Overview first when billing model is unknown (null / loading)', () => {
    expect(commercialTabsFor(null)[0]).toBe('overview');
    expect(commercialTabsFor(undefined)[0]).toBe('overview');
  });

  it('returns exactly 3 tabs for a MILESTONE contract', () => {
    expect(commercialTabsFor('MILESTONE')).toEqual([
      'overview',
      'contract-milestones',
      'billing-collection',
    ]);
  });

  it('returns exactly 3 tabs for a MEASURED_IPC contract', () => {
    expect(commercialTabsFor('MEASURED_IPC')).toEqual([
      'overview',
      'applications',
      'billing-collection',
    ]);
  });

  it('shows contract-milestones (not applications) for MILESTONE', () => {
    const tabs = commercialTabsFor('MILESTONE');
    expect(tabs).toContain('contract-milestones');
    expect(tabs).not.toContain('applications');
  });

  it('shows applications (not contract-milestones) for MEASURED_IPC', () => {
    const tabs = commercialTabsFor('MEASURED_IPC');
    expect(tabs).toContain('applications');
    expect(tabs).not.toContain('contract-milestones');
  });

  it('falls back to MILESTONE layout when billing model is unknown', () => {
    for (const model of [null, undefined] as const) {
      const tabs = commercialTabsFor(model);
      expect(tabs).toContain('contract-milestones');
      expect(tabs).not.toContain('applications');
    }
  });

  it('does not include retired tabs for any billing model', () => {
    const retiredTabs = ['contract-security', 'payment-schedule', 'variations'] as const;
    for (const model of ['MILESTONE', 'MEASURED_IPC', null, undefined] as const) {
      const tabs = commercialTabsFor(model);
      for (const retired of retiredTabs) {
        expect(tabs).not.toContain(retired);
      }
    }
  });

  it('routes the Contract & Milestones tab to its own path', () => {
    expect(commercialTabHref('p-1', 'contract-milestones')).toBe(
      '/projects/p-1/commercial/contract-milestones',
    );
  });

  it('routes the Overview tab to its own path', () => {
    expect(commercialTabHref('p-1', 'overview')).toBe('/projects/p-1/commercial/overview');
  });
});

/**
 * Overview is the universal landing tab for all billing models.
 */
describe('commercialLandingTab — always Overview', () => {
  it('lands on Overview for a MILESTONE contract', () => {
    expect(commercialLandingTab('MILESTONE', true)).toBe('overview');
  });

  it('lands on Overview for a measured contract', () => {
    expect(commercialLandingTab('MEASURED_IPC', true)).toBe('overview');
  });

  it('lands on Overview even when there is no contract', () => {
    expect(commercialLandingTab('MILESTONE', false)).toBe('overview');
    expect(commercialLandingTab(null, false)).toBe('overview');
  });
});
