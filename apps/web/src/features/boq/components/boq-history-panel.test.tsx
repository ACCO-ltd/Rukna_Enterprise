import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { BoqChangeEventResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

vi.mock('../hooks/use-boq', () => ({ useBoqHistory: vi.fn() }));
import { useBoqHistory } from '../hooks/use-boq';
import { BoqHistoryPanel } from './boq-history-panel';

function event(over: Partial<BoqChangeEventResponse>): BoqChangeEventResponse {
  return {
    id: 'e1',
    versionId: 'v1',
    nodeId: 'n1',
    code: '02.01.001',
    action: 'UPDATE',
    field: null,
    oldValue: null,
    newValue: null,
    detail: null,
    actorUserId: 'u1',
    actorName: 'Ahmed Shirie',
    createdAt: '2026-09-03T14:22:00.000Z',
    ...over,
  };
}

function mockHistory(
  data: BoqChangeEventResponse[],
  state: { isPending?: boolean; isError?: boolean; error?: unknown } = {},
) {
  vi.mocked(useBoqHistory).mockReturnValue({
    data,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
    error: state.error,
  } as never);
}

const props = {
  projectId: 'p1',
  versionId: 'v1',
  currency: 'USD',
  canViewCommercials: true,
  open: true,
  onToggle: () => {},
};

describe('BoqHistoryPanel', () => {
  it('renders a value edit as who / what / old → new', () => {
    mockHistory([event({ field: 'unitRate', oldValue: '80', newValue: '85.00' })]);
    renderWithProviders(<BoqHistoryPanel {...props} />);
    expect(screen.getByText('Ahmed Shirie')).toBeInTheDocument();
    expect(screen.getByText(/changed rate of 02\.01\.001/)).toBeInTheDocument();
  });

  it('shows the server summary for a structural change', () => {
    mockHistory([event({ action: 'CREATE', detail: 'Added item 02.01.004' })]);
    renderWithProviders(<BoqHistoryPanel {...props} />);
    expect(screen.getByText(/Added item 02\.01\.004/)).toBeInTheDocument();
  });

  it('redacts rate values from a user without commercial visibility', () => {
    mockHistory([event({ field: 'unitRate', oldValue: '80', newValue: '85.00' })]);
    renderWithProviders(<BoqHistoryPanel {...props} canViewCommercials={false} />);
    expect(screen.queryByText(/85\.00/)).not.toBeInTheDocument();
    expect(screen.getByText(/changed the rate of 02\.01\.001/)).toBeInTheDocument();
  });

  it('shows an empty state when nothing has changed', () => {
    mockHistory([]);
    renderWithProviders(<BoqHistoryPanel {...props} />);
    expect(screen.getByText('No changes recorded yet.')).toBeInTheDocument();
  });

  it('does not fetch until the disclosure is open', () => {
    mockHistory([]);
    renderWithProviders(<BoqHistoryPanel {...props} open={false} />);
    // The hook is always called (rules of hooks), but with enabled=false when collapsed.
    expect(vi.mocked(useBoqHistory)).toHaveBeenCalledWith('p1', 'v1', expect.objectContaining({ enabled: false }));
  });
});
