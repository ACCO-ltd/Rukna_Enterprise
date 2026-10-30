import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';

import { ReceiptForm } from './receipt-form';

const push = vi.fn();
const nav = vi.hoisted(() => ({ query: 'clientId=c1' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => new URLSearchParams(nav.query) }));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({ isPending: false, isError: false, data: [{ id: 'c1', code: 'CL-1', name: 'Water Agency' }] }),
}));
vi.mock('@/features/accounting/hooks/use-accounting', () => ({
  useBankAccounts: () => ({
    isPending: false,
    isError: false,
    data: [
      { id: 'b1', bankName: 'Premier Bank', accountName: 'Operating', status: 'ACTIVE', allowsReceipts: true },
      { id: 'b2', bankName: 'Old Bank', accountName: 'Closed', status: 'CLOSED', allowsReceipts: true },
    ],
  }),
}));
vi.mock('@/features/accounting/hooks/use-invoices', () => ({
  useInvoices: () => ({
    isError: false,
    data: [
      { id: 'i2', clientId: 'c1', invoiceNumber: 'INV-000002', dueDate: '2026-10-30', postingStatus: 'POSTED', outstandingAmount: '1000.00' },
      { id: 'i1', clientId: 'c1', invoiceNumber: 'INV-000001', dueDate: '2026-09-30', postingStatus: 'POSTED', outstandingAmount: '300.00' },
      { id: 'd1', clientId: 'c1', invoiceNumber: null, dueDate: '2026-09-01', postingStatus: 'NOT_POSTED', outstandingAmount: '50.00' },
    ],
  }),
}));
const receivePayment = vi.fn();
vi.mock('../api/receipts-api', () => ({ receivePayment: (p: unknown) => receivePayment(p), createReceipt: vi.fn() }));

beforeEach(() => {
  receivePayment.mockReset().mockResolvedValue({ id: 'r9' });
  push.mockReset();
  nav.query = 'clientId=c1';
});

describe('ReceiptForm — Receive payment (ADR-046 §6)', () => {
  it('posts straight into the chosen bank, applied oldest first, the rest unapplied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });

    // A closed account is never offered.
    await chooseOption(user, screen.getByLabelText('Received into'), 'b1');
    expect(screen.queryByRole('option', { name: /Old Bank/ })).toBeNull();
    await user.type(screen.getByLabelText('Amount'), '1500');

    // The unissued draft is not offered; the oldest invoice is settled first.
    expect(screen.getByLabelText('Amount applied to INV-000001')).toHaveValue('300.00');
    expect(screen.getByLabelText('Amount applied to INV-000002')).toHaveValue('1,000.00');
    expect(screen.getByText('Applied $1,300.00 · $200.00 stays unapplied on the client')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0]).toMatchObject({
      clientId: 'c1',
      bankAccountId: 'b1',
      amount: '1500.00',
      currency: 'USD',
      allocations: [
        { clientInvoiceId: 'i1', amount: 300 },
        { clientInvoiceId: 'i2', amount: 1000 },
      ],
    });
    await waitFor(() => expect(push).toHaveBeenCalledWith('/receipts/r9'));
  });

  it('CI-5: from an invoice’s Record payment, the balance goes to that invoice, not the oldest', async () => {
    nav.query = 'clientId=c1&invoiceId=i2&amount=1000.00';
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });

    expect(screen.getByLabelText('Amount')).toHaveValue('1,000.00');
    expect(screen.getByLabelText('Amount applied to INV-000002')).toHaveValue('1,000.00');
    expect(screen.getByLabelText('Amount applied to INV-000001')).toHaveValue('0.00');

    await chooseOption(user, screen.getByLabelText('Received into'), 'b1');
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0].allocations).toEqual([{ clientInvoiceId: 'i2', amount: 1000 }]);
  });

  it('refuses to apply more than was received', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await chooseOption(user, screen.getByLabelText('Received into'), 'b1');
    await user.type(screen.getByLabelText('Amount'), '100');
    const line = screen.getByLabelText('Amount applied to INV-000002');
    await user.clear(line);
    await user.type(line, '50');
    expect(screen.getByRole('alert')).toHaveTextContent('Applied $150.00 is more than the $100.00 received.');
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    expect(receivePayment).not.toHaveBeenCalled();
  });
});
