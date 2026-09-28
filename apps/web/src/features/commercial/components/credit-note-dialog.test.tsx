import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import * as invoiceApi from '../api/commercial-invoice-api';
import { CreditNoteDialog } from './credit-note-dialog';

vi.mock('../api/commercial-invoice-api', () => ({
  createInvoiceCreditNote: vi.fn(),
  postInvoiceCreditNote: vi.fn(),
}));

function renderDialog() {
  const onOpenChange = vi.fn();
  const onIssued = vi.fn();
  renderWithProviders(
    <CreditNoteDialog
      open
      onOpenChange={onOpenChange}
      onIssued={onIssued}
      projectId="p1"
      invoiceId="inv-1"
      invoiceNumber="INV-0042"
      balanceDue="1050.00"
    />,
  );
  return { onOpenChange, onIssued };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CreditNoteDialog — the only correction once an invoice is issued', () => {
  it('asks for a reason and an amount in words before calling the API', async () => {
    const user = userEvent.setup();
    renderDialog();
    await user.click(screen.getByRole('button', { name: 'Issue credit note' }));
    expect(screen.getByText('Choose a reason.')).toBeInTheDocument();
    expect(screen.getByText('Enter the amount to credit.')).toBeInTheDocument();
    expect(invoiceApi.createInvoiceCreditNote).not.toHaveBeenCalled();
  });

  it('creates then posts the note against the invoice', async () => {
    const user = userEvent.setup();
    vi.mocked(invoiceApi.createInvoiceCreditNote).mockResolvedValue({ id: 'cn-1', postingStatus: 'NOT_POSTED' });
    vi.mocked(invoiceApi.postInvoiceCreditNote).mockResolvedValue({
      id: 'cn-1',
      postingStatus: 'POSTED',
      creditNoteNumber: 'CN-0001',
    });
    const { onOpenChange, onIssued } = renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Price error' }));
    await user.type(screen.getByLabelText('Amount before tax'), '200');
    await user.click(screen.getByRole('button', { name: 'Issue credit note' }));

    await waitFor(() => expect(onIssued).toHaveBeenCalledWith('CN-0001'));
    expect(invoiceApi.createInvoiceCreditNote).toHaveBeenCalledWith(
      'p1',
      'inv-1',
      expect.objectContaining({ reason: 'PRICE_ERROR', netAmount: '200.00' }),
    );
    expect(invoiceApi.postInvoiceCreditNote).toHaveBeenCalledWith('p1', 'inv-1', 'cn-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('when posting fails, the retry posts the same note instead of raising a second', async () => {
    const user = userEvent.setup();
    vi.mocked(invoiceApi.createInvoiceCreditNote).mockResolvedValue({ id: 'cn-1', postingStatus: 'NOT_POSTED' });
    vi.mocked(invoiceApi.postInvoiceCreditNote)
      .mockRejectedValueOnce(new Error('Period closed'))
      .mockResolvedValueOnce({ id: 'cn-1', postingStatus: 'POSTED', creditNoteNumber: 'CN-0001' });
    const { onIssued } = renderDialog();

    await user.click(screen.getByRole('radio', { name: 'Correction' }));
    await user.type(screen.getByLabelText('Amount before tax'), '50');
    await user.click(screen.getByRole('button', { name: 'Issue credit note' }));

    await user.click(await screen.findByRole('button', { name: 'Post credit note' }));
    await waitFor(() => expect(onIssued).toHaveBeenCalledWith('CN-0001'));
    expect(invoiceApi.createInvoiceCreditNote).toHaveBeenCalledTimes(1);
    expect(invoiceApi.postInvoiceCreditNote).toHaveBeenCalledTimes(2);
  });
});
