import { Decimal } from '@prisma/client/runtime/library';

import {
  invoiceCollectedFraction,
  stageCollectionStatus,
  type StageCollectionFacts,
  type StageCollectionInvoice,
} from './stage-collection-status.policy.js';

const AS_OF = new Date('2026-10-03T09:00:00Z');

function stage(over: Partial<StageCollectionFacts> = {}): StageCollectionFacts {
  return {
    triggerType: 'MILESTONE',
    programmeMilestoneId: 'm1',
    programmeMilestone: { status: 'VERIFIED' },
    contractStatus: 'ACTIVE',
    readyToBillAt: null,
    dueDate: null,
    ...over,
  };
}

function invoice(over: Partial<StageCollectionInvoice> = {}): StageCollectionInvoice {
  return {
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    totalAmount: new Decimal('1000.00'),
    outstandingAmount: new Decimal('1000.00'),
    dueDate: new Date('2026-10-30'),
    ...over,
  };
}

describe('stageCollectionStatus (ADR-043 Phase 3)', () => {
  it('NOT_READY while the raise blocker stands (unverified / unlinked milestone, inactive contract advance)', () => {
    expect(stageCollectionStatus(stage({ programmeMilestone: { status: 'PLANNED' } }), null, AS_OF)).toBe('NOT_READY');
    expect(stageCollectionStatus(stage({ programmeMilestoneId: null, programmeMilestone: null }), null, AS_OF)).toBe('NOT_READY');
    expect(stageCollectionStatus(stage({ triggerType: 'ADVANCE', contractStatus: 'DRAFT' }), null, AS_OF)).toBe('NOT_READY');
    // marked ready earlier does not override a blocker that has come back
    expect(
      stageCollectionStatus(stage({ programmeMilestone: { status: 'PLANNED' }, readyToBillAt: new Date() }), null, AS_OF),
    ).toBe('NOT_READY');
  });

  it('a date stage is NOT_READY before its date and READY_TO_BILL on it', () => {
    const future = stage({ triggerType: 'TIME_BASED', programmeMilestone: null, programmeMilestoneId: null, dueDate: new Date('2026-10-04') });
    expect(stageCollectionStatus(future, null, AS_OF)).toBe('NOT_READY');
    expect(stageCollectionStatus({ ...future, dueDate: new Date('2026-10-03') }, null, AS_OF)).toBe('READY_TO_BILL');
    expect(stageCollectionStatus({ ...future, readyToBillAt: new Date() }, null, AS_OF)).toBe('READY_TO_BILL');
  });

  it('READY_TO_BILL for a verified stage, and while Finance holds a draft', () => {
    expect(stageCollectionStatus(stage(), null, AS_OF)).toBe('READY_TO_BILL');
    expect(stageCollectionStatus(stage(), invoice({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED' }), AS_OF)).toBe('READY_TO_BILL');
    // a cancelled invoice is no invoice
    expect(stageCollectionStatus(stage(), invoice({ documentStatus: 'CANCELLED', postingStatus: 'NOT_POSTED' }), AS_OF)).toBe('READY_TO_BILL');
  });

  it('BILLED → PART_PAID → PAID from the posted invoice balance', () => {
    expect(stageCollectionStatus(stage(), invoice(), AS_OF)).toBe('BILLED');
    expect(stageCollectionStatus(stage(), invoice({ outstandingAmount: new Decimal('400') }), AS_OF)).toBe('PART_PAID');
    expect(stageCollectionStatus(stage(), invoice({ outstandingAmount: new Decimal('0') }), AS_OF)).toBe('PAID');
    // an opening-balance invoice is issued but never collected in Rukna
    expect(stageCollectionStatus(stage(), invoice({ postingStatus: 'OPENING_BALANCE' }), AS_OF)).toBe('BILLED');
  });

  it('agrees with the schedule paid rule on a zero-total posted invoice (Billed, never Paid)', () => {
    const zero = invoice({ totalAmount: new Decimal('0'), outstandingAmount: new Decimal('0') });
    expect(invoiceCollectedFraction(zero).toString()).toBe('0');
    expect(stageCollectionStatus(stage(), zero, AS_OF)).toBe('BILLED');
    // and the fraction is the schedule's: posted 600 of 1000 collected → 0.6; unposted → 0
    expect(invoiceCollectedFraction(invoice({ outstandingAmount: new Decimal('400') })).toString()).toBe('0.6');
    expect(invoiceCollectedFraction(invoice({ postingStatus: 'NOT_POSTED' })).toString()).toBe('0');
  });

  it('OVERDUE by the one overdue rule — past due with a balance — and never once paid', () => {
    const late = { dueDate: new Date('2026-10-02') };
    expect(stageCollectionStatus(stage(), invoice(late), AS_OF)).toBe('OVERDUE');
    expect(stageCollectionStatus(stage(), invoice({ ...late, outstandingAmount: new Decimal('1') }), AS_OF)).toBe('OVERDUE');
    expect(stageCollectionStatus(stage(), invoice({ ...late, outstandingAmount: new Decimal('0') }), AS_OF)).toBe('PAID');
    // due today is not overdue
    expect(stageCollectionStatus(stage(), invoice({ dueDate: new Date('2026-10-03') }), AS_OF)).toBe('BILLED');
  });
});
