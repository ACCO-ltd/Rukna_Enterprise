import { installmentBillingBlocker } from './installment-billing-eligibility.js';

describe('installmentBillingBlocker — strict CONST-COM-011 (owner decision 2026-09-28)', () => {
  it('bills a work-completion stage only on a linked, site-verified milestone', () => {
    expect(installmentBillingBlocker({ triggerType: 'MILESTONE', programmeMilestoneId: 'm1', programmeMilestone: { status: 'VERIFIED' } })).toBeNull();
  });

  it('refuses a work-completion stage with no milestone linked — a missing link is not a pass', () => {
    expect(installmentBillingBlocker({ triggerType: 'MILESTONE', programmeMilestoneId: null, programmeMilestone: null })).toBe('MILESTONE_NOT_LINKED');
    expect(installmentBillingBlocker({ triggerType: 'MILESTONE' })).toBe('MILESTONE_NOT_LINKED');
  });

  it('refuses a linked milestone not yet verified on site', () => {
    expect(installmentBillingBlocker({ triggerType: 'MILESTONE', programmeMilestoneId: 'm1', programmeMilestone: { status: 'PLANNED' } })).toBe('MILESTONE_NOT_VERIFIED');
  });

  it('bills an advance once the contract is executed, with no site evidence', () => {
    expect(installmentBillingBlocker({ triggerType: 'ADVANCE', contractStatus: 'ACTIVE' })).toBeNull();
  });

  it('refuses an advance before the contract is executed', () => {
    expect(installmentBillingBlocker({ triggerType: 'ADVANCE', contractStatus: 'DRAFT' })).toBe('CONTRACT_NOT_ACTIVE');
    expect(installmentBillingBlocker({ triggerType: 'ADVANCE' })).toBe('CONTRACT_NOT_ACTIVE');
  });

  it('does not gate a time-based stage here', () => {
    expect(installmentBillingBlocker({ triggerType: 'TIME_BASED' })).toBeNull();
  });
});
