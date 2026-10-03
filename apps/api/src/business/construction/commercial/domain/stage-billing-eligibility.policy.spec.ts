import {
  issuePostingDate,
  stageBillingEligibility,
  stagePrepareBlock,
  type StageBillingFacts,
} from './stage-billing-eligibility.policy.js';

const OPEN = { name: 'Oct 2026', status: 'OPEN' };

function facts(over: Partial<StageBillingFacts> = {}, inst: Partial<StageBillingFacts['installment']> = {}): StageBillingFacts {
  return {
    installmentId: 'i1',
    contractStatus: 'ACTIVE',
    installment: {
      triggerType: 'MILESTONE',
      programmeMilestoneId: 'm1',
      programmeMilestone: { status: 'VERIFIED' },
      readyToBillAt: null,
      ...inst,
    },
    invoice: null,
    issuePeriod: OPEN,
    ...over,
  };
}
const stepOf = (e: ReturnType<typeof stageBillingEligibility>, key: string) => e.steps.find((s) => s.key === key)!;

describe('stagePrepareBlock — the prepare command order', () => {
  it('contract first, then CONST-COM-011, then an existing invoice', () => {
    const inst = { triggerType: 'MILESTONE', programmeMilestoneId: null, programmeMilestone: null };
    expect(stagePrepareBlock({ contractStatus: 'DRAFT', installment: inst, invoice: { documentStatus: 'DRAFT' } })).toBe('CONTRACT_NOT_ACTIVE');
    expect(stagePrepareBlock({ contractStatus: 'ACTIVE', installment: inst, invoice: { documentStatus: 'DRAFT' } })).toBe('MILESTONE_NOT_LINKED');
    expect(
      stagePrepareBlock({
        contractStatus: 'ACTIVE',
        installment: { ...inst, programmeMilestoneId: 'm', programmeMilestone: { status: 'VERIFIED' } },
        invoice: { documentStatus: 'DRAFT' },
      }),
    ).toBe('STAGE_ALREADY_INVOICED');
  });
  it('a cancelled invoice frees the stage', () => {
    expect(
      stagePrepareBlock({
        contractStatus: 'ACTIVE',
        installment: { triggerType: 'ADVANCE' },
        invoice: { documentStatus: 'CANCELLED' },
      }),
    ).toBeNull();
  });
});

describe('stageBillingEligibility', () => {
  it('unverified milestone: blocked, owner Construction', () => {
    const e = stageBillingEligibility(facts({}, { programmeMilestone: { status: 'IN_PROGRESS' } }));
    expect(stepOf(e, 'MILESTONE_VERIFIED')).toMatchObject({ status: 'BLOCKED', owner: 'CONSTRUCTION', code: 'MILESTONE_NOT_VERIFIED', detail: 'IN_PROGRESS' });
    expect(e.canPrepare).toBe(false);
    expect(e.blockedReason).toBe('MILESTONE_NOT_VERIFIED');
  });
  it('unlinked milestone: link blocked, verification pending', () => {
    const e = stageBillingEligibility(facts({}, { programmeMilestoneId: null, programmeMilestone: null }));
    expect(stepOf(e, 'MILESTONE_LINKED')).toMatchObject({ status: 'BLOCKED', code: 'MILESTONE_NOT_LINKED' });
    expect(stepOf(e, 'MILESTONE_VERIFIED').status).toBe('PENDING');
    expect(e.blockedReason).toBe('MILESTONE_NOT_LINKED');
  });
  it('contract not active', () => {
    const e = stageBillingEligibility(facts({ contractStatus: 'DRAFT' }));
    expect(stepOf(e, 'CONTRACT_ACTIVE')).toMatchObject({ status: 'BLOCKED', code: 'CONTRACT_NOT_ACTIVE', detail: 'DRAFT' });
    expect(e.blockedReason).toBe('CONTRACT_NOT_ACTIVE');
  });
  it('advance / time-based: milestone steps not applicable', () => {
    const e = stageBillingEligibility(facts({}, { triggerType: 'ADVANCE', programmeMilestoneId: null, programmeMilestone: null }));
    expect(stepOf(e, 'MILESTONE_LINKED').status).toBe('NOT_APPLICABLE');
    expect(e.canPrepare).toBe(true);
  });
  it('verified, not ready: ready-to-bill pending but NOT a gate (preparing records it)', () => {
    const e = stageBillingEligibility(facts());
    expect(stepOf(e, 'READY_TO_BILL')).toMatchObject({ status: 'PENDING', code: 'NOT_READY' });
    expect(e.canPrepare).toBe(true);
    expect(e.canIssue).toBe(false);
    expect(e.blockedReason).toBeNull();
  });
  it('draft prepared: canIssue while the period is open; blocked by a closed period', () => {
    const draft = { documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' };
    const ok = stageBillingEligibility(facts({ invoice: draft }));
    expect(ok.canPrepare).toBe(false);
    expect(ok.canIssue).toBe(true);
    expect(stepOf(ok, 'INVOICE_PREPARED').status).toBe('DONE');
    const closed = stageBillingEligibility(facts({ invoice: draft, issuePeriod: { name: 'Oct', status: 'CLOSED' } }));
    expect(closed.canIssue).toBe(false);
    expect(closed.blockedReason).toBe('PERIOD_CLOSED');
    expect(stepOf(closed, 'PERIOD_OPEN')).toMatchObject({ status: 'BLOCKED', owner: 'FINANCE', detail: 'Oct' });
    const none = stageBillingEligibility(facts({ invoice: draft, issuePeriod: null }));
    expect(none.blockedReason).toBe('NO_PERIOD');
  });
  it('issued: everything done, STAGE_ISSUED', () => {
    const e = stageBillingEligibility(facts({ invoice: { documentStatus: 'APPROVED', postingStatus: 'POSTED' }, contractStatus: 'CLOSED' }));
    expect(e.blockedReason).toBe('STAGE_ISSUED');
    expect(e.steps.every((s) => s.status === 'DONE' || s.status === 'NOT_APPLICABLE')).toBe(true);
    expect(e.canPrepare || e.canIssue).toBe(false);
  });
});

describe('issuePostingDate — the date an issue posts at', () => {
  const today = new Date('2026-10-03T12:00:00Z');
  it('no draft → today', () => expect(issuePostingDate(null, today).toISOString().slice(0, 10)).toBe('2026-10-03'));
  it('an earlier draft is re-dated to today', () =>
    expect(issuePostingDate(new Date('2026-09-01T00:00:00Z'), today).toISOString().slice(0, 10)).toBe('2026-10-03'));
  it('a future-dated draft keeps its date', () =>
    expect(issuePostingDate(new Date('2026-11-01T00:00:00Z'), today).toISOString().slice(0, 10)).toBe('2026-11-01'));
});
