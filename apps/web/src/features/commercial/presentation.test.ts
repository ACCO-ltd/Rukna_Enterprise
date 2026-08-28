import { describe, expect, it } from 'vitest';
import type { CommercialMetric } from '@erp/types';

import {
  contractStatusTone,
  guaranteeAttentionTone,
  isBilledInstallment,
  metricDisplay,
  paymentInstallmentTone,
  settlementTone,
  variationStatusTone,
} from './presentation';

function metric(partial: Partial<CommercialMetric>): CommercialMetric {
  return {
    state: 'OK',
    amount: '100.00',
    currency: 'USD',
    sourceCount: 1,
    drillTo: null,
    asOf: null,
    ...partial,
  };
}

describe('metricDisplay — a genuine zero must not look like a blank', () => {
  it('renders OK and ZERO as values', () => {
    expect(metricDisplay(metric({ state: 'OK', amount: '250.00' }))).toEqual({
      kind: 'value',
      amount: '250.00',
      currency: 'USD',
    });
    expect(metricDisplay(metric({ state: 'ZERO', amount: '0.00' }))).toEqual({
      kind: 'value',
      amount: '0.00',
      currency: 'USD',
    });
  });

  it('renders RESTRICTED / UNAVAILABLE / FAILED as reasoned blanks, never a number', () => {
    expect(metricDisplay(metric({ state: 'RESTRICTED', amount: null }))).toEqual({
      kind: 'blank',
      reasonKey: 'restricted',
    });
    expect(metricDisplay(metric({ state: 'UNAVAILABLE', amount: null }))).toEqual({
      kind: 'blank',
      reasonKey: 'unavailable',
    });
    expect(metricDisplay(metric({ state: 'FAILED', amount: null }))).toEqual({
      kind: 'blank',
      reasonKey: 'failed',
    });
  });
});

describe('tone mapping', () => {
  it('maps contract lifecycle to tones', () => {
    expect(contractStatusTone('ACTIVE')).toBe('live');
    expect(contractStatusTone('TERMINATED')).toBe('historical');
    expect(contractStatusTone('UNDER_REVIEW')).toBe('warning');
  });

  it('maps settlement and guarantee attention', () => {
    expect(settlementTone('PAID')).toBe('live');
    expect(settlementTone('UNPAID')).toBe('danger');
    expect(guaranteeAttentionTone('EXPIRED')).toBe('danger');
    expect(guaranteeAttentionTone('EXPIRING_SOON')).toBe('warning');
    expect(guaranteeAttentionTone('NONE')).toBe('live');
  });

  it('maps payment installment bill status — NEXT is the actionable one', () => {
    expect(paymentInstallmentTone('NEXT')).toBe('accent');
    expect(paymentInstallmentTone('UPCOMING')).toBe('neutral');
    expect(paymentInstallmentTone('BILLED')).toBe('info');
    expect(paymentInstallmentTone('PARTIALLY_PAID')).toBe('warning');
    expect(paymentInstallmentTone('PAID')).toBe('live');
  });

  it('maps variation lifecycle — only CLIENT_APPROVED reads as live, terminals as historical', () => {
    expect(variationStatusTone('DRAFT')).toBe('neutral');
    expect(variationStatusTone('PENDING_INTERNAL')).toBe('info');
    expect(variationStatusTone('INTERNAL_APPROVED')).toBe('accent');
    // The one status that actually moves the governing contract value.
    expect(variationStatusTone('CLIENT_APPROVED')).toBe('live');
    // Commercially inert terminals — historical, not alarming red.
    expect(variationStatusTone('REJECTED')).toBe('historical');
    expect(variationStatusTone('WITHDRAWN')).toBe('historical');
  });
});

describe('isBilledInstallment', () => {
  it('is true once an invoice is raised (BILLED/PARTIALLY_PAID/PAID), false before', () => {
    expect(isBilledInstallment('BILLED')).toBe(true);
    expect(isBilledInstallment('PARTIALLY_PAID')).toBe(true);
    expect(isBilledInstallment('PAID')).toBe(true);
    expect(isBilledInstallment('NEXT')).toBe(false);
    expect(isBilledInstallment('UPCOMING')).toBe(false);
  });
});
