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
    contractKind: 'CLIENT_CONTRACT' as const,
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
  // ACCO signs on paper, so the lifecycle collapsed to one forward step: a DRAFT is activated
  // straight to ACTIVE. `close` still reaches CLOSED from FINAL_ACCOUNT_PENDING.
  it.each([
    [ContractStatus.DRAFT, 'activate'],
    [ContractStatus.FINAL_ACCOUNT_PENDING, 'close'],
  ])('offers %s → %s', (status, command) => {
    expect(getContractActions(contract(status)).advance).toBe(command);
  });

  // ACTIVE is the gap in the chain: nothing on the contract moves it forward. It reaches
  // FINAL_ACCOUNT_PENDING only when its project records practical completion.
  it('offers no forward command while ACTIVE, but can be reopened', () => {
    const actions = getContractActions(contract(ContractStatus.ACTIVE));
    expect(actions.advance).toBeNull();
    expect(actions.awaitingPracticalCompletion).toBe(true);
    expect(actions.canReopen).toBe(true);
  });

  it.each([ContractStatus.CLOSED, ContractStatus.CANCELLED, ContractStatus.TERMINATED])(
    'offers no forward command from the terminal state %s',
    (status) => {
      expect(getContractActions(contract(status)).advance).toBeNull();
    },
  );
});

describe('getContractActions — cancel, terminate and reopen', () => {
  // Cancel is available only before the contract goes live — which, post-collapse, is DRAFT
  // alone. Once ACTIVE it is reopened (to correct) or terminated (to stop), never cancelled:
  // cancelled means it never took effect.
  it('allows cancel only from DRAFT', () => {
    expect(getContractActions(contract(ContractStatus.DRAFT)).canCancel).toBe(true);
    for (const status of [
      ContractStatus.ACTIVE,
      ContractStatus.FINAL_ACCOUNT_PENDING,
      ContractStatus.CLOSED,
      ContractStatus.CANCELLED,
      ContractStatus.TERMINATED,
    ]) {
      expect(getContractActions(contract(status)).canCancel).toBe(false);
    }
  });

  it('allows terminate and reopen only while ACTIVE', () => {
    const activeActions = getContractActions(contract(ContractStatus.ACTIVE));
    expect(activeActions.canTerminate).toBe(true);
    expect(activeActions.canReopen).toBe(true);
    for (const status of [
      ContractStatus.DRAFT,
      ContractStatus.FINAL_ACCOUNT_PENDING,
      ContractStatus.CLOSED,
    ]) {
      const actions = getContractActions(contract(status));
      expect(actions.canTerminate).toBe(false);
      expect(actions.canReopen).toBe(false);
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
  // `activate` freezes the client's name and tax number onto the contract and opens billing;
  // `close` is final. Both forward steps deserve a stop.
  it('confirms activate and close', () => {
    expect(requiresConfirmation('activate')).toBe(true);
    expect(requiresConfirmation('close')).toBe(true);
  });
});
