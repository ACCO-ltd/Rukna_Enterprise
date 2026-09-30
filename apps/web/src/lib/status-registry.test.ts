import { describe, expect, it } from 'vitest';

import type { StatusTone } from '@erp/ui';

import { STATUS_REGISTRY, statusLabel, statusTone, type StatusVocabulary } from './status-registry';

describe('statusTone', () => {
  it('resolves per vocabulary — the same word can carry different tones', () => {
    expect(statusTone('ACTIVE', 'project')).toBe('progress');
    expect(statusTone('ACTIVE', 'masterData')).toBe('success');
    expect(statusTone('APPROVED', 'supplierBill')).toBe('success');
    expect(statusTone('PENDING', 'posting')).toBe('progress');
  });

  it('keeps the three document axes independent', () => {
    expect(statusTone('APPROVED', 'supplierBill')).toBe('success');
    expect(statusTone('FAILED', 'posting')).toBe('danger');
    expect(statusTone('MATCHED_WITH_TOLERANCE', 'billMatch')).toBe('attention');
  });

  it('never tones a terminal state as danger unless it stopped short (TERMINATED)', () => {
    expect(statusTone('CANCELLED', 'contract')).toBe('historical');
    expect(statusTone('TERMINATED', 'contract')).toBe('danger');
    expect(statusTone('REVERSED', 'journal')).toBe('historical');
  });

  it('falls back to the generic table, then to neutral', () => {
    expect(statusTone('SUPERSEDED', 'ipc')).toBe('historical');
    expect(statusTone('OVERDUE')).toBe('danger');
    expect(statusTone('SOME_FUTURE_STATUS', 'journal')).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
    expect(statusTone(undefined, 'project')).toBe('neutral');
  });

  it('only ever uses the six canonical tones', () => {
    const tones = new Set(['neutral', 'progress', 'attention', 'success', 'danger', 'historical']);
    for (const table of Object.values(STATUS_REGISTRY)) {
      for (const tone of Object.values(table)) expect(tones.has(tone)).toBe(true);
    }
  });
});

describe('vocabularies added when per-feature tone maps were retired (ADR-034)', () => {
  const cases: Array<[StatusVocabulary, Record<string, StatusTone>]> = [
    ['fiscalYear', { DRAFT: 'neutral', OPEN: 'progress', LOCKED: 'attention', CLOSED: 'historical' }],
    ['ipcSettlement', { UNPAID: 'neutral', PARTIALLY_PAID: 'progress', PAID: 'success', OVER_ALLOCATED: 'danger' }],
    ['ipcEffectiveness', { EFFECTIVE: 'success', SUPERSEDED: 'historical' }],
    ['documentRevision', { DRAFT: 'neutral', ISSUED: 'success', SUPERSEDED: 'historical', WITHDRAWN: 'historical' }],
    [
      'requirementApproval',
      { DRAFT: 'neutral', SUBMITTED: 'progress', APPROVED: 'success', CANCELLED: 'historical', CLOSED: 'historical' },
    ],
    ['requirementFulfilment', { NOT_ORDERED: 'neutral', PARTIALLY_ORDERED: 'progress', FULLY_ORDERED: 'success' }],
    ['poFunding', { NOT_FUNDED: 'neutral', PARTIALLY_FUNDED: 'progress', FUNDED: 'success' }],
    ['poReceiving', { NOT_RECEIVED: 'neutral', PARTIALLY_RECEIVED: 'progress', RECEIVED: 'success' }],
    ['poSettlement', { OPEN: 'progress', ACTION_REQUIRED: 'attention', SETTLED: 'success' }],
    ['costBudget', { DRAFT: 'neutral', BASELINED: 'success', SUPERSEDED: 'historical' }],
    [
      'paymentInstallment',
      {
        UPCOMING: 'neutral',
        NEXT: 'neutral',
        READY: 'progress',
        DRAFT: 'neutral',
        BILLED: 'progress',
        PARTIALLY_PAID: 'progress',
        PAID: 'success',
      },
    ],
    [
      'commercialTodo',
      {
        OVERDUE_INVOICE: 'danger',
        READY_TO_INVOICE: 'progress',
        DRAFT_INVOICE: 'neutral',
        ISSUED_NOT_SENT: 'attention',
        BLOCKED_STAGE: 'neutral',
      },
    ],
    [
      'milestoneJourney',
      {
        upcoming: 'neutral',
        'in-progress': 'progress',
        'review-for-billing': 'attention',
        'ready-to-bill': 'success',
        'invoice-draft': 'attention',
        'invoice-issued': 'progress',
        'awaiting-payment': 'progress',
        invoiced: 'progress',
        'partially-paid': 'progress',
        paid: 'success',
      },
    ],
    [
      'commercialCycle',
      {
        NO_CONTRACT: 'neutral',
        REVIEW_FOR_BILLING: 'attention',
        READY_TO_BILL: 'success',
        ALL_BILLED: 'progress',
        ALL_COMPLETE: 'success',
      },
    ],
    [
      'invoiceCollection',
      {
        DRAFT: 'neutral',
        AWAITING_PAYMENT: 'progress',
        PARTIALLY_PAID: 'progress',
        PAID: 'success',
        OVERDUE: 'danger',
        CANCELLED: 'historical',
        AWAITING_POSTING: 'attention',
      },
    ],
    [
      'variationBilling',
      { APPROVED_NOT_BILLED: 'attention', INVOICE_DRAFT: 'neutral', INVOICED: 'success', OMISSION_BILLED: 'success' },
    ],
    ['severity', { INFO: 'neutral', WARNING: 'attention', URGENT: 'danger', CRITICAL: 'danger' }],
    ['financeControl', { OK: 'success', ATTENTION: 'attention', UNAVAILABLE: 'neutral' }],
    ['scheduleHealth', { AHEAD: 'success', ON_TRACK: 'success', BEHIND: 'attention', INSUFFICIENT_DATA: 'neutral' }],
    ['costSignal', { ALIGNED: 'success', PROGRESS_AHEAD: 'progress', COST_AHEAD: 'attention', INSUFFICIENT_DATA: 'neutral', HIDDEN: 'neutral' }],
    [
      'collectionSignal',
      { ALIGNED: 'success', CASH_AHEAD: 'progress', WORK_AHEAD: 'attention', INSUFFICIENT_DATA: 'neutral', HIDDEN: 'neutral' },
    ],
    ['programmeMilestone', { PLANNED: 'neutral', VERIFIED: 'success' }],
    [
      'approvalPolicy',
      {
        DRAFT: 'neutral',
        IN_REVIEW: 'progress',
        SCHEDULED: 'progress',
        ACTIVE: 'success',
        SUPERSEDED: 'historical',
        RETIRED: 'historical',
      },
    ],
  ];

  it.each(cases)('%s maps every value to its documented tone', (vocabulary, expected) => {
    for (const [status, tone] of Object.entries(expected)) {
      expect(statusTone(status, vocabulary)).toBe(tone);
    }
    // No value in the vocabulary is left untested.
    expect(Object.keys(STATUS_REGISTRY[vocabulary]).sort()).toEqual(Object.keys(expected).sort());
  });

  it('keeps the variation workflow terminals apart: REJECTED is danger, WITHDRAWN is historical', () => {
    expect(statusTone('REJECTED', 'variation')).toBe('danger');
    expect(statusTone('WITHDRAWN', 'variation')).toBe('historical');
    expect(statusTone('CLIENT_APPROVED', 'variation')).toBe('success');
  });

  it('has no guarantee vocabulary — ACCO does not use guarantees; the generic table covers them', () => {
    expect(statusTone('ACTIVE')).toBe('success');
    expect(statusTone('EXPIRING_SOON')).toBe('attention');
    expect(statusTone('EXPIRED')).toBe('danger');
    expect(statusTone('DISCHARGED')).toBe('neutral');
  });
});

describe('statusLabel', () => {
  it('humanises enum values', () => {
    expect(statusLabel('PENDING_INTERNAL')).toBe('Pending internal');
    expect(statusLabel('NOT_POSTED', 'posting')).toBe('Not posted');
  });

  it('applies vocabulary overrides', () => {
    expect(statusLabel('DRAFT', 'project')).toBe('Preparation');
    expect(statusLabel('DRAFT', 'journal')).toBe('Draft');
  });
});
