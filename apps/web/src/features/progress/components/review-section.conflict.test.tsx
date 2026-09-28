import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DailyProgressReportResponse } from '@erp/types';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

/**
 * The 409 path end to end through the real TanStack hooks: only the API layer is mocked, so the
 * invalidation → refetch → queue refresh actually happens, and the notice has to survive it.
 */
const api = vi.hoisted(() => ({
  listDprs: vi.fn(),
  getDpr: vi.fn(),
  getProjectProgress: vi.fn(),
  approveDpr: vi.fn(),
  returnDpr: vi.fn(),
}));

vi.mock('../api/progress-api', () => api);
vi.mock('../hooks/use-boq-leaves', () => ({
  useBoqLeaves: () => ({ isPending: false, hasBaseline: true, leaves: [] }),
  lineLabel: (l: { code: string }) => l.code,
}));
vi.mock('./dpr-detail', () => ({ DprEvidence: () => null }));

import { ReviewSection } from './review-section';

const submitted: DailyProgressReportResponse = {
  id: 'dpr-1',
  projectId: 'p1',
  reportDate: '2026-09-26',
  status: 'SUBMITTED',
  preparedBy: 'se-1',
  preparedByName: 'Omar Ali',
  workPackages: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listDprs.mockResolvedValueOnce([submitted]).mockResolvedValue([{ ...submitted, status: 'APPROVED' }]);
  api.getDpr.mockResolvedValue({ ...submitted, measurements: [], attachments: [], labourRows: [], equipmentRows: [], observations: [] });
  api.getProjectProgress.mockResolvedValue([]);
  api.approveDpr.mockRejectedValue(new ApiError(409, 'Someone else approved this report.', 'DPR_CHANGED'));
});

describe('ReviewSection — report changed by someone else', () => {
  it('keeps the notice after the refetch empties the queue, until dismissed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReviewSection projectId="p1" />, { permissions: ['approve:progress'] });

    await user.click(await screen.findByRole('button', { name: 'Approve' }));

    // The refetch ran and the report left the queue (the panel that raised the error is gone)…
    await waitFor(() => expect(api.listDprs).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('No reports waiting for review')).toBeInTheDocument();
    // …and the notice is still there, with the server's own words.
    expect(screen.getByText(/was changed by someone else — the queue has been refreshed\. Someone else approved this report\./)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText(/was changed by someone else/)).not.toBeInTheDocument();
  });
});
