import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { approveMaterialRequest, getMaterialRequest } from '../api/procurement-api';
import type { MaterialRequest } from '../types';
import { MrDetail } from './mr-detail';

vi.mock('../api/procurement-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/procurement-api')>()),
  getMaterialRequest: vi.fn(),
  approveMaterialRequest: vi.fn(),
}));
vi.mock('@/features/projects/hooks/use-projects', () => ({
  useProjects: () => ({ data: [] }),
}));
vi.mock('@/features/workflows/components/approval-panel', () => ({ ApprovalPanel: () => null }));
vi.mock('@/features/workflows/hooks/use-approval', () => ({
  useApprovalStep: () => ({ data: undefined, isPending: false }),
}));
vi.mock('@/features/workflows/hooks/use-workflow-definition', () => ({
  useWorkflowDefinition: () => ({ data: undefined, isPending: false }),
}));

const SUBMITTED: MaterialRequest = {
  id: 'mr-1',
  mrNumber: 'MR-2026-0048',
  requestScope: 'PROJECT',
  projectId: 'p1',
  status: 'SUBMITTED',
  approvalInstanceId: null,
  requestedBy: 'someone-else',
  requestedDate: '2026-09-28',
  requiredByDate: '2026-10-05',
  description: 'Rebar and binding wire for level 2 slab',
  notes: null,
  lines: [],
};

const APPROVER = ['view:procurement', 'approve:material-request'];

beforeEach(() => {
  vi.mocked(getMaterialRequest).mockReset();
  vi.mocked(approveMaterialRequest).mockReset();
});

describe('MrDetail — approve', () => {
  it('lets someone holding approve:material-request approve a submitted request', async () => {
    vi.mocked(getMaterialRequest).mockResolvedValue(SUBMITTED);
    vi.mocked(approveMaterialRequest).mockResolvedValue({ ...SUBMITTED, status: 'APPROVED' });
    renderWithProviders(<MrDetail id="mr-1" />, { permissions: APPROVER });

    await userEvent.click(await screen.findByRole('button', { name: 'Approve' }));
    expect(await screen.findByText('Approve MR-2026-0048?')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Approve' });
    await userEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(approveMaterialRequest).toHaveBeenCalledWith('mr-1'));
  });

  it('does not offer Approve to the requester', async () => {
    vi.mocked(getMaterialRequest).mockResolvedValue({ ...SUBMITTED, requestedBy: 'test-user' });
    renderWithProviders(<MrDetail id="mr-1" />, { permissions: APPROVER });
    expect(await screen.findByText('MR-2026-0048')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('does not offer Approve without the permission, or before the request is submitted', async () => {
    vi.mocked(getMaterialRequest).mockResolvedValue(SUBMITTED);
    const { unmount } = renderWithProviders(<MrDetail id="mr-1" />, {
      permissions: ['view:procurement'],
    });
    expect(await screen.findByText('MR-2026-0048')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    unmount();

    vi.mocked(getMaterialRequest).mockResolvedValue({ ...SUBMITTED, status: 'DRAFT' });
    renderWithProviders(<MrDetail id="mr-1" />, { permissions: APPROVER });
    expect(await screen.findByRole('button', { name: 'Submit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
