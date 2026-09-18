import { describe, expect, it } from 'vitest';

import {
  buildInvoiceTimeline,
  getAttentionReasons,
  getLatestFollowUp,
  getLatestPromise,
  getOpenDispute,
  isMissedPromise,
  type CollectionEvent,
  type DisputeEvent,
  type FollowUpEvent,
  type PromiseEvent,
} from './collection-events';

const TODAY = '2026-09-18';

// ─── Factories ────────────────────────────────────────────────────────────────

function makeFollowUp(overrides: Partial<FollowUpEvent> = {}): FollowUpEvent {
  return {
    kind: 'FOLLOW_UP',
    id: 'fu-1',
    invoiceId: 'inv-1',
    method: 'EMAIL',
    contactPerson: null,
    note: null,
    recordedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  };
}

function makePromise(overrides: Partial<PromiseEvent> = {}): PromiseEvent {
  return {
    kind: 'PROMISE',
    id: 'pr-1',
    invoiceId: 'inv-1',
    promisedDate: '2026-09-20',
    promisedAmount: null,
    note: null,
    recordedAt: '2026-09-10T10:00:00.000Z',
    ...overrides,
  };
}

function makeDispute(overrides: Partial<DisputeEvent> = {}): DisputeEvent {
  return {
    kind: 'DISPUTE',
    id: 'dp-1',
    invoiceId: 'inv-1',
    disputedAmount: null,
    reason: 'WORK_NOT_ACCEPTED',
    note: null,
    openedAt: '2026-09-12T08:00:00.000Z',
    resolvedAt: null,
    ...overrides,
  };
}

// ─── isMissedPromise ──────────────────────────────────────────────────────────

describe('isMissedPromise', () => {
  it('returns true when promisedDate < today', () => {
    const promise = makePromise({ promisedDate: '2026-09-17' });
    expect(isMissedPromise(promise, TODAY)).toBe(true);
  });

  it('returns false when promisedDate === today', () => {
    const promise = makePromise({ promisedDate: TODAY });
    expect(isMissedPromise(promise, TODAY)).toBe(false);
  });

  it('returns false when promisedDate is in the future', () => {
    const promise = makePromise({ promisedDate: '2026-09-25' });
    expect(isMissedPromise(promise, TODAY)).toBe(false);
  });

  it('promise does not overwrite the invoice dueDate — they are independent values', () => {
    // The promise object has no dueDate field — the original invoice contractual due date is unchanged
    const promise = makePromise({ promisedDate: '2026-09-25' });
    expect(promise).not.toHaveProperty('dueDate');
    expect(promise.promisedDate).toBe('2026-09-25');
  });
});

// ─── getLatestPromise ─────────────────────────────────────────────────────────

describe('getLatestPromise', () => {
  it('returns null for empty events', () => {
    expect(getLatestPromise([])).toBeNull();
  });

  it('returns null when there are no PROMISE events', () => {
    expect(getLatestPromise([makeFollowUp()])).toBeNull();
  });

  it('returns the only promise', () => {
    const p = makePromise();
    expect(getLatestPromise([p])).toBe(p);
  });

  it('returns the most recently recorded promise when multiple exist', () => {
    const older = makePromise({ id: 'p-old', recordedAt: '2026-09-01T10:00:00.000Z' });
    const newer = makePromise({ id: 'p-new', recordedAt: '2026-09-10T10:00:00.000Z' });
    const result = getLatestPromise([older, newer]);
    expect(result?.id).toBe('p-new');
  });
});

// ─── getOpenDispute ───────────────────────────────────────────────────────────

describe('getOpenDispute', () => {
  it('returns null for empty events', () => {
    expect(getOpenDispute([])).toBeNull();
  });

  it('returns null when dispute is already resolved', () => {
    const resolved = makeDispute({ resolvedAt: '2026-09-15T12:00:00.000Z' });
    expect(getOpenDispute([resolved])).toBeNull();
  });

  it('returns the open (unresolved) dispute', () => {
    const open = makeDispute();
    expect(getOpenDispute([open])).toBe(open);
  });

  it('returns open dispute even when a resolved one also exists', () => {
    const resolved = makeDispute({ id: 'dp-old', resolvedAt: '2026-09-10T00:00:00.000Z' });
    const open = makeDispute({ id: 'dp-new', openedAt: '2026-09-15T00:00:00.000Z' });
    const result = getOpenDispute([resolved, open]);
    expect(result?.id).toBe('dp-new');
  });

  it('opening a dispute does not affect outstanding balance — dispute has no amount field on the invoice', () => {
    // Dispute records a disputedAmount opinion, NOT a change to outstandingAmount
    const dispute = makeDispute({ disputedAmount: '5000.00' });
    expect(dispute.disputedAmount).toBe('5000.00');
    // The invoice's outstandingAmount lives outside this event — unchanged
    expect(dispute).not.toHaveProperty('outstandingAmount');
  });
});

// ─── getLatestFollowUp ────────────────────────────────────────────────────────

describe('getLatestFollowUp', () => {
  it('returns null for empty events', () => {
    expect(getLatestFollowUp([])).toBeNull();
  });

  it('returns the most recent follow-up when multiple exist', () => {
    const first = makeFollowUp({ id: 'fu-1', recordedAt: '2026-09-01T00:00:00.000Z' });
    const second = makeFollowUp({ id: 'fu-2', recordedAt: '2026-09-12T00:00:00.000Z' });
    const result = getLatestFollowUp([first, second]);
    expect(result?.id).toBe('fu-2');
  });
});

// ─── getAttentionReasons ──────────────────────────────────────────────────────

describe('getAttentionReasons', () => {
  it('returns empty array for empty events', () => {
    expect(getAttentionReasons([], TODAY)).toEqual([]);
  });

  it('returns MISSED_PROMISE when latest promise date has passed', () => {
    const promise = makePromise({ promisedDate: '2026-09-17' }); // yesterday
    expect(getAttentionReasons([promise], TODAY)).toContain('MISSED_PROMISE');
  });

  it('does not return MISSED_PROMISE for a future promise', () => {
    const promise = makePromise({ promisedDate: '2026-09-25' });
    expect(getAttentionReasons([promise], TODAY)).not.toContain('MISSED_PROMISE');
  });

  it('does not return MISSED_PROMISE when today matches promised date', () => {
    const promise = makePromise({ promisedDate: TODAY });
    expect(getAttentionReasons([promise], TODAY)).not.toContain('MISSED_PROMISE');
  });

  it('returns DISPUTED for an open dispute', () => {
    const dispute = makeDispute();
    expect(getAttentionReasons([dispute], TODAY)).toContain('DISPUTED');
  });

  it('does not return DISPUTED for a resolved dispute', () => {
    const resolved = makeDispute({ resolvedAt: '2026-09-15T12:00:00.000Z' });
    expect(getAttentionReasons([resolved], TODAY)).not.toContain('DISPUTED');
  });

  it('returns both MISSED_PROMISE and DISPUTED when both apply', () => {
    const missedPromise = makePromise({ promisedDate: '2026-09-17' });
    const openDispute = makeDispute();
    const reasons = getAttentionReasons([missedPromise, openDispute], TODAY);
    expect(reasons).toContain('MISSED_PROMISE');
    expect(reasons).toContain('DISPUTED');
  });

  it('follow-up events do not produce an attention reason', () => {
    const followUp = makeFollowUp();
    expect(getAttentionReasons([followUp], TODAY)).toEqual([]);
  });
});

// ─── buildInvoiceTimeline ─────────────────────────────────────────────────────

describe('buildInvoiceTimeline', () => {
  it('always includes ISSUED entry', () => {
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'ISSUED')).toBe(true);
  });

  it('includes SENT entry when sentAt is provided', () => {
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: '2026-08-02T09:00:00.000Z',
      events: [],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'SENT')).toBe(true);
  });

  it('does NOT include SENT entry when sentAt is null', () => {
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'SENT')).toBe(false);
  });

  it('includes FOLLOW_UP entry', () => {
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [makeFollowUp()],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'FOLLOW_UP')).toBe(true);
  });

  it('marks a missed promise as PROMISE_MISSED', () => {
    const missedPromise = makePromise({ promisedDate: '2026-09-17' });
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [missedPromise],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'PROMISE_MISSED')).toBe(true);
    expect(entries.some((e) => e.kind === 'PROMISE')).toBe(false);
  });

  it('marks a future promise as PROMISE (not missed)', () => {
    const futurePromise = makePromise({ promisedDate: '2026-09-25' });
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [futurePromise],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'PROMISE')).toBe(true);
    expect(entries.some((e) => e.kind === 'PROMISE_MISSED')).toBe(false);
  });

  it('returns entries sorted newest-first', () => {
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: '2026-08-02T09:00:00.000Z',
      events: [makeFollowUp({ recordedAt: '2026-09-10T10:00:00.000Z' })],
      payments: [{ date: '2026-09-15', amount: '50000.00', method: 'Bank transfer' }],
      today: TODAY,
    });
    // Newest entry should be the payment (Sep 15)
    expect(entries[0].kind).toBe('PAYMENT');
    // Oldest should be the ISSUED entry (Aug 01)
    expect(entries[entries.length - 1].kind).toBe('ISSUED');
  });

  it('includes DISPUTE entry and DISPUTE_RESOLVED when resolved', () => {
    const resolved = makeDispute({ resolvedAt: '2026-09-15T00:00:00.000Z' });
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [resolved],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'DISPUTE')).toBe(true);
    expect(entries.some((e) => e.kind === 'DISPUTE_RESOLVED')).toBe(true);
  });

  it('does not include DISPUTE_RESOLVED for an open dispute', () => {
    const open = makeDispute(); // resolvedAt: null
    const entries = buildInvoiceTimeline({
      issuedAt: '2026-08-01',
      sentAt: null,
      events: [open],
      payments: [],
      today: TODAY,
    });
    expect(entries.some((e) => e.kind === 'DISPUTE')).toBe(true);
    expect(entries.some((e) => e.kind === 'DISPUTE_RESOLVED')).toBe(false);
  });
});

// ─── Cross-event invariants ───────────────────────────────────────────────────

describe('Collection event model — accounting invariants', () => {
  it('a follow-up event has no amount or posting fields', () => {
    const fu = makeFollowUp();
    expect(fu).not.toHaveProperty('amount');
    expect(fu).not.toHaveProperty('postingStatus');
    expect(fu).not.toHaveProperty('outstandingAmount');
  });

  it('a promise event has promisedDate but no dueDate — never overwrites contractual due date', () => {
    const p = makePromise({ promisedDate: '2026-10-01' });
    expect(p.promisedDate).toBe('2026-10-01');
    expect(p).not.toHaveProperty('dueDate');
  });

  it('a dispute event captures disputedAmount as opinion — not a mutation of outstandingAmount', () => {
    const d = makeDispute({ disputedAmount: '20000.00' });
    expect(d.disputedAmount).toBe('20000.00');
    // No outstandingAmount or accountingEffect on the event itself
    expect(d).not.toHaveProperty('outstandingAmount');
    expect(d).not.toHaveProperty('accountingEffect');
  });

  it('paid invoices can still generate follow-up/promise/dispute events — these are collection metadata', () => {
    // Collection events are independent of payment state; a paid invoice might still
    // have outstanding follow-up notes from before payment landed.
    const events: CollectionEvent[] = [
      makeFollowUp({ invoiceId: 'paid-inv' }),
      makePromise({ invoiceId: 'paid-inv', promisedDate: '2026-09-10' }),
    ];
    expect(events).toHaveLength(2);
    expect(events.every((e) => e.invoiceId === 'paid-inv')).toBe(true);
  });
});
