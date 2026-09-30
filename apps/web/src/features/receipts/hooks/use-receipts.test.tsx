import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { useAllocateToInvoice, useCreateReceipt, usePostReceipt } from './use-receipts';

/**
 * Recording money against a client is the step a clerk most needs to see land, so each receipt
 * command confirms itself through the shared mutation feedback (`meta.successToast`).
 */

const mocks = vi.hoisted(() => ({
  createReceipt: vi.fn(),
  postReceipt: vi.fn(),
  allocateToInvoice: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../api/receipts-api', () => ({
  createReceipt: mocks.createReceipt,
  postReceipt: mocks.postReceipt,
  allocateToInvoice: mocks.allocateToInvoice,
  reverseAllocation: vi.fn(),
  getReceipt: vi.fn(),
  listReceipts: vi.fn(),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

function Harness() {
  const create = useCreateReceipt();
  const post = usePostReceipt('rcp-1');
  const allocate = useAllocateToInvoice('rcp-1');
  return (
    <>
      <button
        type="button"
        onClick={() =>
          create.mutate({ clientId: 'cl-1', receiptDate: '2026-09-30', amount: '100.00', currency: 'USD' })
        }
      >
        Record
      </button>
      <button type="button" onClick={() => post.mutate({} as never)}>
        Post
      </button>
      <button type="button" onClick={() => allocate.mutate({} as never)}>
        Allocate
      </button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('receipt feedback', () => {
  it('confirms a recorded receipt, then opens it', async () => {
    mocks.createReceipt.mockResolvedValue({ id: 'rcp-9' });
    renderWithProviders(<Harness />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    expect(await screen.findByText('Receipt recorded')).toBeInTheDocument();
    expect(mocks.push).toHaveBeenCalledWith('/receipts/rcp-9');
  });

  it('confirms posting and allocation', async () => {
    mocks.postReceipt.mockResolvedValue({ id: 'rcp-1' });
    mocks.allocateToInvoice.mockResolvedValue({ id: 'alloc-1' });
    renderWithProviders(<Harness />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));
    expect(await screen.findByText('Receipt posted')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Allocate' }));
    expect(await screen.findByText('Receipt allocated to the invoice')).toBeInTheDocument();
  });
});
