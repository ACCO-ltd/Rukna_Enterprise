import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReceivableWriteOffView } from '@erp/types';

import { renderWithProviders } from '@/test/render';

/** AR-4 — writing off a balance: the dialog says when it goes to Approvals; the panel decides. */
const mocks = vi.hoisted(() => ({ request: vi.fn(), decide: vi.fn() }));
vi.mock('./hooks', () => ({
  useRequestWriteOff: () => ({ mutate: mocks.request, reset: vi.fn(), isPending: false, isError: false, error: null }),
  useDecideWriteOff: () => ({ mutate: mocks.decide, reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('@/features/auth/session/use-session', () => ({ useSession: () => ({ user: { id: 'me' } }) }));

import { WriteOffDialog } from './write-off-dialog';
import { WriteOffsPanel } from './write-offs-panel';

const writeOff = (overrides: Partial<ReceivableWriteOffView>): ReceivableWriteOffView => ({
  id: 'wo1',
  invoiceId: 'inv1',
  writeOffNumber: null,
  reason: 'BAD_DEBT',
  note: null,
  amount: '600.00',
  accountingDate: '2026-10-29',
  status: 'PENDING_APPROVAL',
  requestedBy: 'amina',
  requestedByName: 'Amina Yusuf',
  requestedAt: '2026-10-29T09:00:00.000Z',
  approvedByName: null,
  rejectedByName: null,
  rejectionReason: null,
  reversalReason: null,
  reversedAt: null,
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe('WriteOffDialog', () => {
  it('posts a small balance at once, and says a larger one goes to Approvals', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WriteOffDialog open onOpenChange={vi.fn()} invoiceId="inv1" balance="3.50" approvalAbove="50.00" />);
    expect(screen.getByText(/It posts now/)).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Small balance/ }));
    await user.click(screen.getByRole('button', { name: 'Write off' }));
    expect(mocks.request).toHaveBeenCalledWith(expect.objectContaining({ amount: '3.50', reason: 'SMALL_BALANCE' }), expect.anything());
  });

  it('above the limit the action reads "Send for approval"; more than the balance is refused', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WriteOffDialog open onOpenChange={vi.fn()} invoiceId="inv1" balance="900.00" approvalAbove="50.00" />);
    expect(screen.getByText('This goes to Approvals first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeInTheDocument();
    const amount = screen.getByLabelText('Amount to write off');
    await user.clear(amount);
    await user.type(amount, '901');
    expect(screen.getByText('This is more than the invoice still owes.')).toBeInTheDocument();
  });
});

describe('WriteOffsPanel', () => {
  it("lets someone else approve or reject a waiting write-off, never the requester", async () => {
    const user = userEvent.setup();
    const { unmount } = renderWithProviders(<WriteOffsPanel writeOffs={[writeOff({})]} canManage />);
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mocks.decide).toHaveBeenCalledWith({ id: 'wo1', action: 'approve' });
    unmount();

    renderWithProviders(<WriteOffsPanel writeOffs={[writeOff({ requestedBy: 'me' })]} canManage />);
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText('Someone else approves it')).toBeInTheDocument();
  });

  it('reverses a posted write-off with a reason', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WriteOffsPanel writeOffs={[writeOff({ status: 'POSTED', writeOffNumber: 'WO-000001' })]} canManage />);
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    await user.type(screen.getByLabelText(/Why/), 'Client paid after all');
    await user.click(screen.getAllByRole('button', { name: 'Reverse' }).at(-1)!);
    expect(mocks.decide).toHaveBeenCalledWith({ id: 'wo1', action: 'reverse', reason: 'Client paid after all' }, expect.anything());
  });
});
