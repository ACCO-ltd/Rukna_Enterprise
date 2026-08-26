import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgressPeriodComparisonResponse, ProjectProgressLine } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useProjectProgress: vi.fn(),
  useProgressPeriodComparison: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => mocks);

import { VerifiedProgressSection } from './verified-progress-section';

const LINES: ProjectProgressLine[] = [
  {
    boqNodeId: 'n1',
    code: 'A.1',
    description: 'Excavation',
    measurableQuantity: '1000',
    verifiedToDate: '620',
    percentComplete: 62,
  },
];

const COMPARISON: ProgressPeriodComparisonResponse = {
  projectId: 'proj-1',
  previousPeriodEndDate: '2026-07-31',
  currentPeriodEndDate: '2026-08-31',
  physical: { previous: 40, current: 62, delta: 22 },
  verified: { previous: 36, current: 58, delta: 22 },
};

const INSUFFICIENT_COMPARISON: ProgressPeriodComparisonResponse = {
  projectId: 'proj-1',
  previousPeriodEndDate: null,
  currentPeriodEndDate: '2026-08-31',
  physical: null,
  verified: null,
};

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useProjectProgress.mockReturnValue(loaded(LINES));
  mocks.useProgressPeriodComparison.mockReturnValue(loaded(COMPARISON));
});

describe('VerifiedProgressSection', () => {
  it('keeps the per-BOQ-leaf verified table', () => {
    renderWithProviders(<VerifiedProgressSection projectId="proj-1" />);

    expect(screen.getByText('A.1')).toBeInTheDocument();
    expect(screen.getByText('Excavation')).toBeInTheDocument();
  });

  it('shows the overall period comparison with its delta', () => {
    renderWithProviders(<VerifiedProgressSection projectId="proj-1" />);

    expect(screen.getByText('Period comparison')).toBeInTheDocument();
    expect(screen.getByText('40% → 62%')).toBeInTheDocument();
    // The delta is present and directional.
    expect(screen.getAllByText('+22%').length).toBeGreaterThanOrEqual(1);
  });

  it('says the comparison needs two periods rather than inventing a delta', () => {
    mocks.useProgressPeriodComparison.mockReturnValue(loaded(INSUFFICIENT_COMPARISON));
    renderWithProviders(<VerifiedProgressSection projectId="proj-1" />);

    expect(
      screen.getByText('Comparison appears once two periods have been recorded.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/→/)).not.toBeInTheDocument();
  });
});
