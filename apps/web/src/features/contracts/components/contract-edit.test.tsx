import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { BillingModel } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import type { Contract } from '../types';

const mocks = vi.hoisted(() => ({ useContract: vi.fn() }));
vi.mock('../hooks/use-contracts', () => ({ useContract: mocks.useContract }));

vi.mock('./contract-form', () => ({
  ContractForm: () => <div data-testid="contract-form" />,
}));
vi.mock('./contract-read-only-view', () => ({
  ContractReadOnlyView: ({ reason }: { reason: string }) => (
    <div data-testid="contract-read-only-view" data-reason={reason} />
  ),
}));

import { ContractEdit } from './contract-edit';

function contract(overrides: Partial<Contract> = {}): Contract {
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
    status: 'DRAFT' as Contract['status'],
    clientNameSnapshot: null,
    clientTaxSnapshot: null,
    startDate: null,
    expectedEndDate: null,
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * `ContractEdit` decides between a live, submittable form and a read-only view of the same
 * facts. Both status (DRAFT-only) and permission (`canEdit`) gate the form — a regression in
 * either would show an editable form to someone who cannot actually save it.
 */
describe('ContractEdit', () => {
  it('renders the editable form only when canEdit is true and the contract is DRAFT', () => {
    mocks.useContract.mockReturnValue({
      data: contract({ status: 'DRAFT' as Contract['status'] }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ContractEdit id="c1" projectId="p1" canEdit />);

    expect(screen.getByTestId('contract-form')).toBeInTheDocument();
    expect(screen.queryByTestId('contract-read-only-view')).not.toBeInTheDocument();
  });

  it('renders the read-only view with reason "noPermission" when canEdit is false, even on a DRAFT contract', () => {
    mocks.useContract.mockReturnValue({
      data: contract({ status: 'DRAFT' as Contract['status'] }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ContractEdit id="c1" projectId="p1" canEdit={false} />);

    expect(screen.queryByTestId('contract-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('contract-read-only-view')).toHaveAttribute(
      'data-reason',
      'noPermission',
    );
  });

  it('renders the read-only view with reason "notDraft" when the contract is not a draft, even for an editor', () => {
    mocks.useContract.mockReturnValue({
      data: contract({ status: 'ACTIVE' as Contract['status'] }),
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ContractEdit id="c1" projectId="p1" canEdit />);

    expect(screen.queryByTestId('contract-form')).not.toBeInTheDocument();
    expect(screen.getByTestId('contract-read-only-view')).toHaveAttribute(
      'data-reason',
      'notDraft',
    );
  });
});
