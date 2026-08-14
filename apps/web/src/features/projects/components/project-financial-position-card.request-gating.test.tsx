import { screen, waitFor } from '@testing-library/react';
import type { ProjectFinancialPositionResponse } from '@erp/types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * Proves the permission gate at the network boundary, not just the render tree: without
 * `view:financial-position` the component must make ZERO requests (the endpoint 403s, and a
 * request the UI will only discard is a console error and a failed request in QA).
 *
 * The REAL `useProjectFinancialPosition` hook runs here — only the api function is spied — so
 * the `enabled` wiring is exercised end to end rather than mocked away.
 */

const apiMocks = vi.hoisted(() => ({ getProjectFinancialPosition: vi.fn() }));
const permMocks = vi.hoisted(() => ({ can: vi.fn(() => true) }));

vi.mock('@/features/accounting/api/accounting-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/accounting/api/accounting-api')>()),
  getProjectFinancialPosition: apiMocks.getProjectFinancialPosition,
}));
vi.mock('@/features/auth/permissions/can', () => ({
  usePermissions: () => ({ can: permMocks.can, canAny: () => true, moduleVisible: () => true }),
}));

import { ProjectFinancialPositionCard } from './project-financial-position-card';

const DATA: ProjectFinancialPositionResponse = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  permMocks.can.mockReturnValue(true);
  apiMocks.getProjectFinancialPosition.mockResolvedValue(DATA);
});

describe('ProjectFinancialPositionCard — request gating (real query)', () => {
  it('makes zero requests without view:financial-position', async () => {
    permMocks.can.mockReturnValue(false);
    const { container } = renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);

    // Give any (incorrect) mount effect a chance to fire before asserting nothing was requested.
    await new Promise((resolve) => setTimeout(resolve, 25));

    expect(apiMocks.getProjectFinancialPosition).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('requests exactly once and renders permitted data with the permission', async () => {
    permMocks.can.mockReturnValue(true);
    renderWithProviders(<ProjectFinancialPositionCard projectId="p1" />);

    await waitFor(() => expect(apiMocks.getProjectFinancialPosition).toHaveBeenCalledTimes(1));
    expect(apiMocks.getProjectFinancialPosition).toHaveBeenCalledWith('p1');
    expect(await screen.findByText(/250,000/)).toBeInTheDocument();
  });
});
