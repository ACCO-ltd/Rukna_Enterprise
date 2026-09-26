import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { BillingModel } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import type { Contract } from '../types';
import { ContractReadOnlyView } from './contract-read-only-view';

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
    status: 'ACTIVE' as Contract['status'],
    clientNameSnapshot: null,
    clientTaxSnapshot: null,
    startDate: '2026-02-01T00:00:00.000Z',
    expectedEndDate: '2027-02-01T00:00:00.000Z',
    createdBy: 'u1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('ContractReadOnlyView', () => {
  it('shows the same five facts the edit form would, as text', () => {
    renderWithProviders(
      <ContractReadOnlyView contract={contract()} backHref="/back" reason="noPermission" />,
    );

    expect(screen.getByText('ACCO-2026-001')).toBeInTheDocument();
    expect(screen.getByText(/4,500,000/)).toBeInTheDocument();
  });

  it('explains a missing permission, not a status message, for reason="noPermission"', () => {
    renderWithProviders(
      <ContractReadOnlyView contract={contract()} backHref="/back" reason="noPermission" />,
    );

    expect(screen.getByText("You don't have permission to edit this contract.")).toBeInTheDocument();
    expect(
      screen.queryByText('A contract can only be edited while it is a draft.'),
    ).not.toBeInTheDocument();
  });

  it('explains the draft-only rule, not a permission message, for reason="notDraft"', () => {
    renderWithProviders(
      <ContractReadOnlyView contract={contract()} backHref="/back" reason="notDraft" />,
    );

    expect(screen.getByText('A contract can only be edited while it is a draft.')).toBeInTheDocument();
    expect(
      screen.queryByText("You don't have permission to edit this contract."),
    ).not.toBeInTheDocument();
  });

  it('links back to the given backHref', () => {
    renderWithProviders(
      <ContractReadOnlyView contract={contract()} backHref="/projects/p1/commercial/contract-security" reason="notDraft" />,
    );

    const back = screen.getByRole('link');
    expect(back).toHaveAttribute('href', '/projects/p1/commercial/contract-security');
  });
});
