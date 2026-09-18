import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import type { CommercialSummaryResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { CommercialWorkspace } from './commercial-workspace';

/**
 * Slice 7: Overview is now a real tab, not a redirect target.
 * CommercialWorkspace with active="overview" renders the OverviewTab directly.
 */

vi.mock('./commercial-cycle-ribbon', () => ({
  CommercialCycleRibbon: () => null,
}));

vi.mock('./overview-tab', () => ({
  OverviewTab: ({ projectId }: { projectId: string }) => (
    <div data-testid="overview-tab">{projectId}</div>
  ),
}));

const summaryData = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../hooks/use-commercial', () => ({
  useCommercialSummary: () => ({
    data: summaryData.value,
    isPending: summaryData.value == null,
    isError: false,
    isSuccess: summaryData.value != null,
    error: null,
  }),
  useCommercialOverview: () => ({ isPending: true, isError: false, data: undefined }),
}));

function summary(billingModel: string | null): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    mainContract: billingModel
      ? ({ id: 'c-1', billingModel } as CommercialSummaryResponse['mainContract'])
      : null,
  } as CommercialSummaryResponse;
}

describe('CommercialWorkspace — Overview tab (Slice 7)', () => {
  it('renders the OverviewTab when active="overview" without waiting for summary', () => {
    summaryData.value = null; // summary still loading
    renderWithProviders(<CommercialWorkspace projectId="p-1" active="overview" />, {
      permissions: ['view:contract'],
    });

    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  it('renders the OverviewTab for a MILESTONE contract', () => {
    summaryData.value = summary('MILESTONE');
    renderWithProviders(<CommercialWorkspace projectId="p-1" active="overview" />, {
      permissions: ['view:contract'],
    });

    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });

  it('renders the OverviewTab when there is no contract', () => {
    summaryData.value = summary(null);
    renderWithProviders(<CommercialWorkspace projectId="p-1" active="overview" />, {
      permissions: ['view:contract'],
    });

    expect(screen.getByTestId('overview-tab')).toBeInTheDocument();
  });
});
