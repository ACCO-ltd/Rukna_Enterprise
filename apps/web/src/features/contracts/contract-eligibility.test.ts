import { BillingModel, ContractStatus } from '@erp/types';
import { describe, expect, it } from 'vitest';

import type { Contract } from './types';
import { isOperationalClientContract } from './contract-eligibility';

function contract(
  status: ContractStatus,
  contractKind: Contract['contractKind'] = 'CLIENT_CONTRACT',
): Contract {
  return {
    id: 'contract-1',
    projectId: 'project-1',
    organizationId: 'org-1',
    clientId: 'client-1',
    boqVersionId: 'boq-1',
    contractNumber: 'MAIN-001',
    contractValue: '1000.00',
    currency: 'USD',
    billingModel: BillingModel.MEASURED_IPC,
    contractKind,
    status,
    clientNameSnapshot: null,
    clientTaxSnapshot: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('isOperationalClientContract', () => {
  it.each([ContractStatus.ACTIVE, ContractStatus.FINAL_ACCOUNT_PENDING])(
    'accepts an executed client contract in %s',
    (status) => expect(isOperationalClientContract(contract(status))).toBe(true),
  );

  it.each([
    ContractStatus.DRAFT,
    ContractStatus.UNDER_REVIEW,
    ContractStatus.PENDING_SIGNATURE,
    ContractStatus.CLOSED,
    ContractStatus.CANCELLED,
    ContractStatus.TERMINATED,
  ])('rejects a client contract in %s', (status) => {
    expect(isOperationalClientContract(contract(status))).toBe(false);
  });

  it('rejects an active subcontract', () => {
    expect(isOperationalClientContract(contract(ContractStatus.ACTIVE, 'SUBCONTRACT'))).toBe(false);
  });
});
