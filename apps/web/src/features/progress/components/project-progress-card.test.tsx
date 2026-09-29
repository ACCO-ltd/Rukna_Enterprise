import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  usePhysicalFinancialSignal: vi.fn(),
  useProjectRollup: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => ({
  usePhysicalFinancialSignal: mocks.usePhysicalFinancialSignal,
  useProjectRollup: mocks.useProjectRollup,
}));

import { ProjectProgressCard } from './project-progress-card';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

const base = {
  projectId: 'p1',
  physicalPercent: 30,
  actualCost: null,
  budgetTotal: null,
  weightsComplete: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProjectRollup.mockReturnValue(loaded({ weightsComplete: true, weightsTotal: '1' }));
});

describe('ProjectProgressCard — money-derived signal visibility', () => {
  it('shows the status and its hint when the caller may see the cost ratio', () => {
    mocks.usePhysicalFinancialSignal.mockReturnValue(
      loaded({ ...base, moneyVisible: true, costConsumedPercent: 60, divergence: -30, status: 'COST_AHEAD' }),
    );
    renderWithProviders(<ProjectProgressCard projectId="p1" />);

    expect(screen.getByText('30%')).toBeInTheDocument();
    expect(screen.getByText('Cost ahead of progress')).toBeInTheDocument();
  });

  it('shows only the physical % when the server hides the comparison (HIDDEN)', () => {
    mocks.usePhysicalFinancialSignal.mockReturnValue(
      loaded({ ...base, moneyVisible: false, costConsumedPercent: null, divergence: null, status: 'HIDDEN' }),
    );
    const { container } = renderWithProviders(<ProjectProgressCard projectId="p1" />);

    expect(screen.getByText('30%')).toBeInTheDocument();
    // No status pill, no hint, no raw key, and no "not enough data" claim about the project.
    expect(container.textContent).not.toMatch(/HIDDEN|Not enough data|On track|Cost ahead|forecast cost/);
  });
});
