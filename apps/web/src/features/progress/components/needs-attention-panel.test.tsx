import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useDprs: vi.fn(),
  useProjectRollup: vi.fn(),
  useWorkPackages: vi.fn(),
}));

vi.mock('../hooks/use-progress', () => mocks);
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: () => ({ leaves: [], isPending: false, hasBaseline: false }),
}));

import { NeedsAttentionPanel } from './needs-attention-panel';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NeedsAttentionPanel', () => {
  it('renders nothing for an unset-up project rather than claiming it is clear', () => {
    mocks.useDprs.mockReturnValue(loaded([]));
    mocks.useProjectRollup.mockReturnValue(loaded({ packages: [], weightsComplete: false, weightsTotal: '0' }));
    mocks.useWorkPackages.mockReturnValue(loaded([]));

    const { container } = renderWithProviders(
      <NeedsAttentionPanel projectId="proj-1" onGoTo={() => {}} />,
    );

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/Nothing needs attention/i)).not.toBeInTheDocument();
  });

  it('shows the clear state once the project is set up and nothing is actually pending', () => {
    mocks.useDprs.mockReturnValue(loaded([]));
    mocks.useProjectRollup.mockReturnValue(
      loaded({ packages: [{ id: 'wp-1', leafCount: 1 }], weightsComplete: true, weightsTotal: '1' }),
    );
    mocks.useWorkPackages.mockReturnValue(loaded([{ id: 'wp-1' }]));

    renderWithProviders(<NeedsAttentionPanel projectId="proj-1" onGoTo={() => {}} />);

    expect(screen.getByText(/Nothing needs attention/i)).toBeInTheDocument();
  });

  it('flags incomplete weights on a set-up project instead of the clear state', () => {
    mocks.useDprs.mockReturnValue(loaded([]));
    mocks.useProjectRollup.mockReturnValue(
      loaded({ packages: [{ id: 'wp-1', leafCount: 1 }], weightsComplete: false, weightsTotal: '0.6' }),
    );
    mocks.useWorkPackages.mockReturnValue(loaded([{ id: 'wp-1' }]));

    renderWithProviders(<NeedsAttentionPanel projectId="proj-1" onGoTo={() => {}} />);

    expect(screen.queryByText(/Nothing needs attention/i)).not.toBeInTheDocument();
    expect(screen.getByText(/60%, not 100%/i)).toBeInTheDocument();
  });
});
