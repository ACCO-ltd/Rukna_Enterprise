import { BillingModel } from '@erp/types';
import { describe, expect, it } from 'vitest';

import {
  EMPTY_CONTRACT_FORM,
  toContractFormValues,
  toCreateContractPayload,
  toDecimalString,
  toUpdateContractPayload,
  type ContractFormValues,
} from './contract-form-payload';
import type { Contract } from './types';

const filled: ContractFormValues = {
  projectId: 'p1',
  clientId: 'cl1',
  boqVersionId: 'v1',
  contractNumber: 'ACCO-2026-001',
  contractValue: '4500000',
  currency: 'USD',
  billingModel: BillingModel.MEASURED_IPC,
  startDate: '2026-02-01',
  expectedEndDate: '2027-08-31',
};

describe('toDecimalString', () => {
  it.each([
    ['4500000', '4500000.00'],
    ['4500000.5', '4500000.50'],
    ['4500000.55', '4500000.55'],
    ['  4500000.5  ', '4500000.50'],
    ['0.05', '0.05'],
    ['.5', '0.50'],
  ])('normalizes %s to %s', (input, expected) => {
    expect(toDecimalString(input)).toBe(expected);
  });

  it('truncates beyond two places rather than rounding, matching the Decimal(18,2) column', () => {
    expect(toDecimalString('1.999')).toBe('1.99');
  });

  it('returns an empty string for empty input', () => {
    expect(toDecimalString('')).toBe('');
    expect(toDecimalString('   ')).toBe('');
  });
});

describe('toCreateContractPayload', () => {
  it('always sends the three identity fields', () => {
    const payload = toCreateContractPayload(filled);
    expect(payload.projectId).toBe('p1');
    expect(payload.clientId).toBe('cl1');
    expect(payload.boqVersionId).toBe('v1');
  });

  it('sends the value as a normalized decimal string, never a number', () => {
    const payload = toCreateContractPayload(filled);
    expect(payload.contractValue).toBe('4500000.00');
    expect(typeof payload.contractValue).toBe('string');
  });

  it('omits empty dates rather than sending empty strings', () => {
    const payload = toCreateContractPayload({
      ...filled,
      startDate: '',
      expectedEndDate: '',
    });

    expect(payload).not.toHaveProperty('startDate');
    expect(payload).not.toHaveProperty('expectedEndDate');
  });

  it('omits the billing model when the form has none', () => {
    const payload = toCreateContractPayload({ ...EMPTY_CONTRACT_FORM, billingModel: '' });
    expect(payload).not.toHaveProperty('billingModel');
  });
});

describe('toUpdateContractPayload', () => {
  it('sends the editable commercial fields', () => {
    expect(toUpdateContractPayload(filled)).toEqual({
      contractNumber: 'ACCO-2026-001',
      contractValue: '4500000.00',
      currency: 'USD',
      billingModel: BillingModel.MEASURED_IPC,
      startDate: '2026-02-01',
      expectedEndDate: '2027-08-31',
    });
  });

  // What a contract is FOR is fixed at creation — UpdateContractDto declares none of these.
  it.each(['projectId', 'clientId', 'boqVersionId'])('never sends %s', (field) => {
    expect(toUpdateContractPayload(filled)).not.toHaveProperty(field);
  });

  // Sending null would look like an attempt to clear the date, but the service maps it
  // through `dto.startDate ? new Date(...) : undefined`, so null is a silent no-op —
  // verified against the running API. Omitting says the same thing without the pretence.
  it('omits a cleared date instead of sending null', () => {
    const payload = toUpdateContractPayload({ ...filled, startDate: '' });
    expect(payload).not.toHaveProperty('startDate');
    expect(payload.expectedEndDate).toBe('2027-08-31');
  });
});

describe('toContractFormValues', () => {
  it('fills the form from a contract, trimming the ISO timestamp to a date input value', () => {
    const contract: Contract = {
      id: 'c1',
      projectId: 'p1',
      organizationId: 'org1',
      clientId: 'cl1',
      boqVersionId: 'v1',
      contractNumber: 'ACCO-2026-001',
      contractValue: '4500000.00',
      currency: 'USD',
      billingModel: BillingModel.MEASURED_IPC,
      contractKind: 'CLIENT_CONTRACT' as const,
      status: 'DRAFT' as Contract['status'],
      clientNameSnapshot: null,
      clientTaxSnapshot: null,
      startDate: '2026-02-01T00:00:00.000Z',
      expectedEndDate: null,
      createdBy: 'u1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };

    expect(toContractFormValues(contract)).toEqual({
      projectId: 'p1',
      clientId: 'cl1',
      boqVersionId: 'v1',
      contractNumber: 'ACCO-2026-001',
      contractValue: '4500000.00',
      currency: 'USD',
      billingModel: BillingModel.MEASURED_IPC,
      startDate: '2026-02-01',
      expectedEndDate: '',
    });
  });
});
