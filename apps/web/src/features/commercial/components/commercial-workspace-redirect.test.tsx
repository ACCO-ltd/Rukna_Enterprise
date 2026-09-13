import { beforeEach, describe, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { CommercialSummaryResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';

import { CommercialWorkspace } from './commercial-workspace';

/**
 * S-SH-5: the retired Overview route (`active="overview"`) must redirect to the real landing tab —
 * Payment Schedule for a MILESTONE contract, Contract otherwise — rather than dead-end on a view
 * that no longer exists.
 */
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), prefetch: vi.fn() }),
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
}));

function summary(billingModel: string | null): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    mainContract: billingModel
      ? ({ id: 'c-1', billingModel } as CommercialSummaryResponse['mainContract'])
      : null,
  } as CommercialSummaryResponse;
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryData.value = null;
});

describe('CommercialWorkspace — Overview redirect (S-SH-5)', () => {
  it('redirects the Overview route to Payment Schedule for a MILESTONE contract', async () => {
    summaryData.value = summary('MILESTONE');
    renderWithProviders(<CommercialWorkspace projectId="p-1" active="overview" />, {
      permissions: ['view:contract'],
    });

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/projects/p-1/commercial/payment-schedule'),
    );
  });

  it('redirects the Overview route to Contract when there is no contract', async () => {
    summaryData.value = summary(null);
    renderWithProviders(<CommercialWorkspace projectId="p-1" active="overview" />, {
      permissions: ['view:contract'],
    });

    await waitFor(() =>
      expect(replace).toHaveBeenCalledWith('/projects/p-1/commercial/contract-security'),
    );
  });
});
