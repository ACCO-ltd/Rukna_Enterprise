import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import {
  useApprovePurchaseOrder,
  useCreateSupplierPayment,
  useSubmitSupplierBill,
} from './use-procurement';

/**
 * Procurement commands confirm themselves through the shared mutation feedback, naming the
 * record they touched — the bill by its number (or, while it is a draft, the supplier's own
 * invoice number), the PO by its number — and never an amount.
 */

const api = vi.hoisted(() => ({
  submitSupplierBill: vi.fn(),
  approvePurchaseOrder: vi.fn(),
  createSupplierPayment: vi.fn(),
}));

vi.mock('../api/procurement-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...api,
}));

function Harness() {
  const submit = useSubmitSupplierBill();
  const approve = useApprovePurchaseOrder();
  const pay = useCreateSupplierPayment();
  return (
    <>
      <button type="button" onClick={() => submit.mutate('bill-1')}>
        Submit bill
      </button>
      <button type="button" onClick={() => approve.mutate({ id: 'po-1' })}>
        Approve PO
      </button>
      <button type="button" onClick={() => pay.mutate({} as never)}>
        Record payment
      </button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('procurement feedback', () => {
  it('names a draft bill by the supplier invoice number when it is submitted', async () => {
    api.submitSupplierBill.mockResolvedValue({
      id: 'bill-1',
      billNumber: null,
      supplierInvoiceNumber: 'INV-9044',
    });
    renderWithProviders(<Harness />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Submit bill' }));

    expect(await screen.findByText('Bill INV-9044 submitted for approval')).toBeInTheDocument();
  });

  it('names the purchase order it approved', async () => {
    api.approvePurchaseOrder.mockResolvedValue({ id: 'po-1', poNumber: 'PO-0012' });
    renderWithProviders(<Harness />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Approve PO' }));

    expect(await screen.findByText('Purchase order PO-0012 approved')).toBeInTheDocument();
  });

  it('reads without a number when a new payment has none yet', async () => {
    api.createSupplierPayment.mockResolvedValue({ id: 'pay-1', paymentNumber: null });
    renderWithProviders(<Harness />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await screen.findByText('Payment saved as a draft')).toBeInTheDocument();
  });
});
