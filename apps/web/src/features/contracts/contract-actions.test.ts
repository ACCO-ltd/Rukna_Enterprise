import { BillingModel, ContractStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import { getContractActions, requiresConfirmation } from './contract-actions';
import type { Contract } from './types';

function contract(status: ContractStatus): Contract {
  return {
    id: 'c1',
    projectId: 'p1',
    organizationId: 'org1',
    clientId: 'cl1',
    boqVersionId: 'v1',
    contractNumber: 'ACCO-2026-001',
    contractValue: '4500000.00',
    currency: 'USD',
    billingModel: BillingModel.MEASURED_IPC,
    status,
    clientNameSnapshot: null,
    clientTaxSnapshot: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('getContractActions — forward lifecycle', () => {
  it.each([
    [ContractStatus.DRAFT, 'submit'],
    [ContractStatus.UNDER_REVIEW, 'approve-review'],
    [ContractStatus.PENDING_SIGNATURE, 'execute'],
    [ContractStatus.FINAL_ACCOUNT_PENDING, 'close'],
  ])('offers %s → %s', (status, command) => {
    expect(getContractActions(contract(status)).advance).toBe(command);
  });

  // ACTIVE is the gap in the chain: nothing on the contract moves it forward. It reaches
  // FINAL_ACCOUNT_PENDING only when its project records practical completion.
  it('offers no forward command while ACTIVE', () => {
    const actions = getContractActions(contract(ContractStatus.ACTIVE));
    expect(actions.advance).toBeNull();
    expect(actions.awaitingPracticalCompletion).toBe(true);
  });

  it.each([ContractStatus.CLOSED, ContractStatus.CANCELLED, ContractStatus.TERMINATED])(
    'offers no forward command from the terminal state %s',
    (status) => {
      expect(getContractActions(contract(status)).advance).toBeNull();
    },
  );
});

describe('getContractActions — cancel and terminate', () => {
  // The important difference from projects: a project can be cancelled while ACTIVE, a
  // contract cannot. Once executed it is terminated instead, and the two words mean
  // different things — never took effect vs took effect and was stopped.
  it.each([
    ContractStatus.DRAFT,
    ContractStatus.UNDER_REVIEW,
    ContractStatus.PENDING_SIGNATURE,
  ])('allows cancel from %s', (status) => {
    expect(getContractActions(contract(status)).canCancel).toBe(true);
  });

  it.each([
    ContractStatus.ACTIVE,
    ContractStatus.FINAL_ACCOUNT_PENDING,
    ContractStatus.CLOSED,
    ContractStatus.CANCELLED,
    ContractStatus.TERMINATED,
  ])('does not allow cancel from %s', (status) => {
    expect(getContractActions(contract(status)).canCancel).toBe(false);
  });

  it('allows terminate only while ACTIVE', () => {
    expect(getContractActions(contract(ContractStatus.ACTIVE)).canTerminate).toBe(true);
    for (const status of [
      ContractStatus.DRAFT,
      ContractStatus.PENDING_SIGNATURE,
      ContractStatus.FINAL_ACCOUNT_PENDING,
      ContractStatus.CLOSED,
    ]) {
      expect(getContractActions(contract(status)).canTerminate).toBe(false);
    }
  });

  it('never offers cancel and terminate at the same time', () => {
    for (const status of Object.values(ContractStatus)) {
      const actions = getContractActions(contract(status));
      expect(actions.canCancel && actions.canTerminate).toBe(false);
    }
  });
});

describe('getContractActions — editing', () => {
  it('allows editing only in DRAFT', () => {
    expect(getContractActions(contract(ContractStatus.DRAFT)).canEdit).toBe(true);
    for (const status of Object.values(ContractStatus).filter((s) => s !== ContractStatus.DRAFT)) {
      expect(getContractActions(contract(status)).canEdit).toBe(false);
    }
  });
});

describe('requiresConfirmation', () => {
  // `execute` freezes the client's name and tax number onto the contract forever, and
  // `close` is final. Both deserve a stop; the two review steps are reversible in practice.
  it('confirms execute and close', () => {
    expect(requiresConfirmation('execute')).toBe(true);
    expect(requiresConfirmation('close')).toBe(true);
  });

  it('does not confirm the review steps', () => {
    expect(requiresConfirmation('submit')).toBe(false);
    expect(requiresConfirmation('approve-review')).toBe(false);
  });
});
