import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import type { MaterialRequest } from '../types';

/**
 * A submitted request is approved or rejected (with a reason) by someone holding
 * approve:material-request; a requester approving their own request is refused in words. A
 * submit routed for approval (409) shows the approval panel and a way to complete it.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/procurement/requests/mr1' }));
vi.mock('@/features/projects/hooks/use-projects', () => ({ useProjects: () => ({ data: [] }) }));
vi.mock('@/features/workflows/components/approval-panel', () => ({
  ApprovalPanel: ({ instanceId }: { instanceId: string | null }) => (instanceId ? <div>Approval panel {instanceId}</div> : null),
}));
vi.mock('@/features/workflows/hooks/use-approval', () => ({ useApprovalStep: () => ({ isPending: false, data: null }) }));
const workflow = vi.hoisted(() => ({
  definition: vi.fn<(...args: unknown[]) => unknown>(() => ({ isPending: false, data: { steps: [] } })),
}));
vi.mock('@/features/workflows/hooks/use-workflow-definition', () => ({
  useWorkflowDefinition: (...args: unknown[]) => workflow.definition(...args),
}));

const state = vi.hoisted(() => ({ request: null as unknown }));
const mutations = vi.hoisted(() => {
  const make = () => ({ mutate: vi.fn(), reset: vi.fn(), isPending: false, error: null as unknown, isError: false });
  return { submit: make(), cancel: make(), approve: make(), reject: make() };
});
vi.mock('../hooks/use-procurement', () => ({
  useMaterialRequest: () => ({ data: state.request, isPending: false, isError: false }),
  useSubmitMaterialRequest: () => mutations.submit,
  useCancelMaterialRequest: () => mutations.cancel,
  useApproveMaterialRequest: () => mutations.approve,
  useRejectMaterialRequest: () => mutations.reject,
}));

import { MrDetail } from './mr-detail';

const request = (patch: Partial<MaterialRequest> = {}): MaterialRequest => ({
  id: 'mr1',
  mrNumber: 'MR-2026-0012',
  requestScope: 'ORGANIZATION',
  projectId: null,
  status: 'SUBMITTED',
  approvalInstanceId: null,
  requestedDate: '2026-10-01',
  requiredByDate: null,
  description: null,
  notes: null,
  lines: [],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  for (const m of Object.values(mutations)) m.error = null;
  state.request = request();
});

describe('MrDetail — approve / reject', () => {
  it('offers Approve and Reject on a submitted request to an approver only', () => {
    const { unmount } = renderWithProviders(<MrDetail id="mr1" />, { permissions: ['approve:material-request'] });
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    unmount();

    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['create:material-request'] });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
  });

  it('does not offer them on a draft', () => {
    state.request = request({ status: 'DRAFT' });
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['approve:material-request'] });
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('rejects with a required reason', async () => {
    const user = userEvent.setup();
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['approve:material-request'] });

    await user.click(screen.getByRole('button', { name: 'Reject' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(within(dialog).getByText('Enter a reason.')).toBeInTheDocument();
    expect(mutations.reject.mutate).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Reason/), 'Quantities too high');
    await user.click(within(dialog).getByRole('button', { name: 'Reject request' }));
    expect(mutations.reject.mutate).toHaveBeenCalledWith({ id: 'mr1', reason: 'Quantities too high' }, expect.anything());
  });

  it('says in words that a requester cannot approve their own request', async () => {
    const user = userEvent.setup();
    mutations.approve.error = new ApiError(403, 'Forbidden', 'FORBIDDEN', [], {
      code: 'REQUESTER_CANNOT_APPROVE_OWN_REQUEST',
    });
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['approve:material-request'] });

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText('You raised this request, so someone else must approve it.'),
    ).toBeInTheDocument();
  });
});

describe('MrDetail — submit routed for approval', () => {
  it('shows the approval panel and Complete submission on a 409 gate', async () => {
    const user = userEvent.setup();
    state.request = request({ status: 'DRAFT' });
    mutations.submit.mutate.mockImplementation((_id: string, options: { onError: (e: unknown) => void }) =>
      options.onError(new ApiError(409, 'Approval required', 'CONFLICT', [], { approvalInstanceId: 'ai-3' })),
    );
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['create:material-request'] });

    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Submit' }));

    expect(await screen.findByText('Approval panel ai-3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete submission' })).toBeInTheDocument();
  });
});

describe('MrDetail — heading', () => {
  it('leads with the request title, and keeps the description beneath it', () => {
    state.request = request({ title: 'Reinforcement steel', description: 'For the level 2 slab pour.' });
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['create:material-request'] });

    expect(screen.getByRole('heading', { level: 2, name: 'Reinforcement steel' })).toBeInTheDocument();
    expect(screen.getByText('For the level 2 slab pour.')).toBeInTheDocument();
  });

  it('falls back to the description when a request has no title', () => {
    state.request = request({ title: null, description: 'Cement for blockwork' });
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['create:material-request'] });

    expect(screen.getByRole('heading', { level: 2, name: 'Cement for blockwork' })).toBeInTheDocument();
  });
});

describe('MrDetail — approval chain', () => {
  it('reads no workflow definition for a request that went through no approval', () => {
    state.request = request({ approvalInstanceId: null });
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['create:material-request'] });

    expect(workflow.definition).toHaveBeenCalledWith('MATERIAL_REQUEST', { enabled: false });
    expect(workflow.definition).not.toHaveBeenCalledWith('MATERIAL_REQUEST', { enabled: true });
  });

  it('reads the definition once the request carries an approval instance', () => {
    state.request = request({ approvalInstanceId: 'ai-3' });
    renderWithProviders(<MrDetail id="mr1" />, { permissions: ['create:material-request'] });

    expect(workflow.definition).toHaveBeenCalledWith('MATERIAL_REQUEST', { enabled: true });
  });
});
