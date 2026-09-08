import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * `/contracts` is now a read-only org-wide portfolio index (P3 Q-C). Two behaviours matter
 * and are easy to regress:
 *
 *  1. There is no "create" affordance anywhere on it — authoring moved into the project
 *     workspace, and a stray CTA here would send users back to the retired standalone flow.
 *  2. Every row links into the project's Commercial workspace, not the old `/contracts/[id]`
 *     detail page.
 */

const mocks = vi.hoisted(() => ({
  useContracts: vi.fn(),
}));

vi.mock('../hooks/use-contracts', () => ({ useContracts: mocks.useContracts }));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

import { ContractsList } from './contracts-list';

function loaded<T>(data: T) {
  return { data, isPending: false, isError: false, isFetching: false, refetch: vi.fn() };
}

const CONTRACT = {
  id: 'c-1',
  projectId: 'p-77',
  organizationId: 'org-1',
  clientId: 'client-1',
  boqVersionId: 'v-1',
  contractNumber: 'ACCO-WBR-26-0065-C1',
  contractValue: '1250000.00',
  currency: 'USD',
  billingModel: 'MILESTONE',
  contractKind: 'CLIENT_CONTRACT',
  status: 'ACTIVE',
  clientNameSnapshot: null,
  clientTaxSnapshot: null,
  startDate: '2026-01-15',
  expectedEndDate: '2026-12-31',
  createdBy: 'user-1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractsList (read-only portfolio index)', () => {
  it('links each row into the project Commercial workspace, not the standalone detail page', () => {
    mocks.useContracts.mockReturnValue(loaded([CONTRACT]));

    renderWithProviders(<ContractsList />);

    const link = screen.getByRole('link', { name: CONTRACT.contractNumber });
    expect(link).toHaveAttribute(
      'href',
      `/projects/${CONTRACT.projectId}/commercial/contract-security`,
    );
  });

  it('shows no create affordance when contracts exist', () => {
    mocks.useContracts.mockReturnValue(loaded([CONTRACT]));

    renderWithProviders(<ContractsList />);

    expect(screen.queryByRole('link', { name: /new contract/i })).toBeNull();
  });

  it('shows no create CTA in the empty state', () => {
    mocks.useContracts.mockReturnValue(loaded([]));

    renderWithProviders(<ContractsList />);

    // The empty message survives; the create button does not.
    expect(screen.getByText('No contracts yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /new contract/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /new contract/i })).toBeNull();
  });
});
