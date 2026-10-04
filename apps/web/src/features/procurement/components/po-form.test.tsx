import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

/**
 * Issue = create (once) → confirm. A DoA binding answers confirm with 409 + approvalInstanceId:
 * the form shows the approval panel and "Complete issue" calls confirm again (ADR-015 re-drive).
 * There is no submit/approve step any more.
 */

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
  usePathname: () => '/procurement/orders/new',
}));

const hooks = vi.hoisted(() => ({
  create: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../hooks/use-procurement', () => ({
  useCreatePurchaseOrder: () => ({ mutateAsync: hooks.create }),
  useConfirmPurchaseOrder: () => ({ mutateAsync: hooks.confirm }),
}));

// The line editor and supplier picker have their own tests; here they are stand-ins so the
// form is valid with one click.
vi.mock('./po-line-editor', async (original) => ({
  ...(await original<object>()),
  PoLineEditor: () => null,
  poLineError: () => null,
  poLineCostTargetIncomplete: () => false,
  orderTotalMinor: () => null,
}));
vi.mock('./supplier-picker', () => ({
  SupplierPicker: ({ onChange }: { onChange: (id: string) => void }) => (
    <button type="button" onClick={() => onChange('sup-1')}>
      Pick supplier
    </button>
  ),
}));
vi.mock('@/features/workflows/components/approval-panel', () => ({
  ApprovalPanel: ({ instanceId }: { instanceId: string }) => <div>Approval panel {instanceId}</div>,
}));

import { PoForm } from './po-form';

beforeEach(() => {
  vi.clearAllMocks();
  hooks.create.mockResolvedValue({ id: 'po-1', poNumber: 'PO-0001' });
});

async function issue() {
  renderWithProviders(<PoForm />);
  await userEvent.click(screen.getByRole('button', { name: 'Pick supplier' }));
  await userEvent.click(screen.getByRole('button', { name: 'Issue purchase order' }));
}

describe('PoForm issue', () => {
  it('creates and confirms in one action, then opens the order', async () => {
    hooks.confirm.mockResolvedValue({ id: 'po-1', poNumber: 'PO-0001' });
    await issue();

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/procurement/orders/po-1'));
    expect(hooks.create).toHaveBeenCalledTimes(1);
    expect(hooks.confirm).toHaveBeenCalledWith('po-1');
  });

  it('shows the approval panel when confirm is gated by a DoA policy', async () => {
    hooks.confirm.mockRejectedValue(
      new ApiError(409, 'Approval required', 'APPROVAL_REQUIRED', [], { approvalInstanceId: 'ai-9' }),
    );
    await issue();

    expect(await screen.findByText('Approval panel ai-9')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete issue' })).toBeInTheDocument();
    expect(routerMocks.push).not.toHaveBeenCalled();
  });

  it('completes the issue by calling confirm again, without creating a second order', async () => {
    hooks.confirm
      .mockRejectedValueOnce(
        new ApiError(409, 'Approval required', 'APPROVAL_REQUIRED', [], { approvalInstanceId: 'ai-9' }),
      )
      .mockResolvedValueOnce({ id: 'po-1', poNumber: 'PO-0001' });
    await issue();

    await userEvent.click(await screen.findByRole('button', { name: 'Complete issue' }));

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/procurement/orders/po-1'));
    expect(hooks.confirm).toHaveBeenCalledTimes(2);
    expect(hooks.create).toHaveBeenCalledTimes(1);
  });

  it('shows a non-gate failure verbatim and stays on the form', async () => {
    hooks.confirm.mockRejectedValue(new ApiError(422, 'Supplier is blocked'));
    await issue();

    expect(await screen.findByText('Supplier is blocked')).toBeInTheDocument();
    expect(routerMocks.push).not.toHaveBeenCalled();
  });
});
