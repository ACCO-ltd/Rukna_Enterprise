import { paymentState, type PaymentState, type PaymentStateFacts } from './payment-state.policy.js';

const base: PaymentStateFacts = {
  poStatus: 'OPEN',
  settlementSettled: false,
  pendingApproval: false,
  awaitingSignatures: false,
  fundedPositive: true,
  advanceOutstandingPositive: false,
  submittedStoreDocument: false,
  anyStoreDocument: false,
  receivingStatus: 'NOT_RECEIVED',
};

/** One fixture per state: each reaches exactly its state. */
const fixtures: Array<[PaymentState, Partial<PaymentStateFacts>]> = [
  ['AWAITING_ORDER', { poStatus: null }],
  ['AWAITING_APPROVAL', { pendingApproval: true, fundedPositive: false }],
  ['AWAITING_SIGNATURES', { awaitingSignatures: true, fundedPositive: false }],
  ['SETTLED', { poStatus: 'CLOSED' }],
  ['READY_TO_PAY', { fundedPositive: false }],
  ['RECEIPT_TO_RECORD', { submittedStoreDocument: true, anyStoreDocument: true, advanceOutstandingPositive: true, receivingStatus: 'RECEIVED' }],
  ['CASH_WITH_BUYER', { advanceOutstandingPositive: true }],
  ['WAITING_FOR_GOODS', {}],
  ['SETTLING', { receivingStatus: 'RECEIVED', anyStoreDocument: true, advanceOutstandingPositive: true }],
];

describe('ADR-045 P2 — payment state policy', () => {
  it.each(fixtures)('%s', (state, facts) => {
    expect(paymentState({ ...base, ...facts })).toBe(state);
  });

  it('every state is reached by exactly one fixture', () => {
    const reached = fixtures.map(([, f]) => paymentState({ ...base, ...f }));
    expect(new Set(reached).size).toBe(fixtures.length);
  });

  it('a DRAFT or CANCELLED order is AWAITING_ORDER; a settled OPEN order is SETTLED', () => {
    expect(paymentState({ ...base, poStatus: 'DRAFT' })).toBe('AWAITING_ORDER');
    expect(paymentState({ ...base, poStatus: 'CANCELLED' })).toBe('AWAITING_ORDER');
    expect(paymentState({ ...base, settlementSettled: true })).toBe('SETTLED');
  });

  it('a submitted receipt before the goods arrive waits for the goods', () => {
    expect(
      paymentState({ ...base, submittedStoreDocument: true, anyStoreDocument: true, advanceOutstandingPositive: true }),
    ).toBe('WAITING_FOR_GOODS');
  });
});
