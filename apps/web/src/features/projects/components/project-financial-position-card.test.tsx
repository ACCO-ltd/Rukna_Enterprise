import { screen } from '@testing-library/react';
import type { ProjectFinancialPositionResponse } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const hookMocks = vi.hoisted(() => ({ useProjectFinancialPosition: vi.fn() }));
const permMocks = vi.hoisted(() => ({ can: vi.fn(() => true) }));

vi.mock('@/features/accounting/hooks/use-accounting', () => hookMocks);
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: permMocks.can, canAny: () => true, moduleVisible: () => true }),
}));

import { ProjectFinancialPositionCard } from './project-financial-position-card';

function position(overrides: Partial<ProjectFinancialPositionResponse> = {}): ProjectFinancialPositionResponse {
  return {
    projectId: 'p1',
    currency: 'USD',
    hasContract: true,
    contractValue: '1000000.00',
    certifiedRevenue: '700000.00',
    invoicedRevenue: '650000.00',
    receivedRevenue: '500000.00',
    outstandingReceivables: '150000.00',
    actualCost: '600000.00',
    remainingCommitments: '150000.00',
    forecastCost: '750000.00',
    forecastMargin: '250000.00',
    asOf: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  permMocks.can.mockReturnValue(true);
});

describe('ProjectFinancialPositionCard', () => {
  it('shows the forecast margin plus revenue and cost metrics', () => {
    hookMocks.useProjectFinancialPosition.mockReturnValue({ data: position(), isPending: false, isError: false });
    renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);

    expect(screen.getByRole('heading', { name: 'Financial Position' })).toBeInTheDocument();
    expect(screen.getByText('Forecast margin')).toBeInTheDocument();
    expect(screen.getByText('Contract value')).toBeInTheDocument();
    expect(screen.getByText('Remaining committed')).toBeInTheDocument();
    // Amounts formatted with the currency.
    expect(screen.getByText(/250,000/)).toBeInTheDocument();
  });

  it('enables the query only with view:financial-position', () => {
    hookMocks.useProjectFinancialPosition.mockReturnValue({ data: position(), isPending: false, isError: false });
    renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);
    // The permission decides whether the request may be made at all.
    expect(hookMocks.useProjectFinancialPosition).toHaveBeenCalledWith('p1', { enabled: true });
  });

  it('renders nothing and disables the query without view:financial-position', () => {
    permMocks.can.mockReturnValue(false);
    hookMocks.useProjectFinancialPosition.mockReturnValue({ data: undefined, isPending: false, isError: false });
    const { container } = renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);

    expect(container).toBeEmptyDOMElement();
    // No permission → the query is disabled, so no request is ever sent (proven end-to-end in
    // project-financial-position-card.request-gating.test.tsx).
    expect(hookMocks.useProjectFinancialPosition).toHaveBeenCalledWith('p1', { enabled: false });
  });

  it('hides revenue and margin, and explains, when there is no main contract', () => {
    hookMocks.useProjectFinancialPosition.mockReturnValue({
      data: position({
        hasContract: false,
        currency: null,
        contractValue: null,
        certifiedRevenue: null,
        invoicedRevenue: null,
        receivedRevenue: null,
        outstandingReceivables: null,
        forecastMargin: null,
      }),
      isPending: false,
      isError: false,
    });
    renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);

    expect(screen.getByText(/No main contract/i)).toBeInTheDocument();
    expect(screen.queryByText('Contract value')).not.toBeInTheDocument();
    // Cost is still reported.
    expect(screen.getByText('Actual cost')).toBeInTheDocument();
  });

  it('surfaces a load failure', () => {
    hookMocks.useProjectFinancialPosition.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
