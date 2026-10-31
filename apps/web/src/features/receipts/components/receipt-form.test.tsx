import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';

import { ReceiptForm } from './receipt-form';

// The calendar popover is not what these tests are about: a plain date box stands in for it.
vi.mock('@erp/ui', async (original) => ({
  ...(await original<object>()),
  DatePicker: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

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
      { id: 'b1', bankName: 'Premier Bank', accountName: 'Operating', accountNumber: '0001234', kind: 'BANK', status: 'ACTIVE', allowsReceipts: true },
      { id: 'b2', bankName: 'Old Bank', accountName: 'Closed', accountNumber: '0009999', kind: 'BANK', status: 'CLOSED', allowsReceipts: true },
      { id: 'c1', bankName: 'Site', accountName: 'Cash box', accountNumber: 'CASH-BOX', kind: 'CASH', status: 'ACTIVE', allowsReceipts: true },
      { id: 'c2', bankName: 'Head office', accountName: 'Safe', accountNumber: 'SAFE', kind: 'CASH', status: 'ACTIVE', allowsReceipts: true },
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
const upload = vi.hoisted(() => ({ uploadFile: vi.fn(), attach: vi.fn() }));
vi.mock('@/features/files/api/files-api', () => ({ uploadFile: upload.uploadFile }));
vi.mock('@/features/finance-attachments/api', () => ({ attachFinanceFile: upload.attach }));

/** Bank transfer with its proof filled in — the tests about applying money need a valid method. */
async function payByTransfer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('radio', { name: 'Bank transfer' }));
  await user.type(screen.getByLabelText('Transfer reference'), 'tt-2210');
  await user.type(screen.getByLabelText('Paying bank'), 'Salaam Bank');
  await user.type(screen.getByLabelText("Payer's account name"), 'Water Agency');
  await user.type(screen.getByLabelText('Value date'), '2026-10-30');
}

beforeEach(() => {
  receivePayment.mockReset().mockResolvedValue({ id: 'r9' });
  upload.uploadFile.mockReset().mockResolvedValue('file-1');
  upload.attach.mockReset().mockResolvedValue({});
  push.mockReset();
  nav.query = 'clientId=c1';
});

describe('ReceiptForm — Receive payment (ADR-046 §6)', () => {
  it('posts straight into the chosen bank, applied oldest first, the rest unapplied', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });

    await payByTransfer(user);
    // A closed account is never offered.
    await chooseOption(user, screen.getByLabelText('Received into'), 'b1');
    expect(screen.queryByRole('option', { name: /Old Bank/ })).toBeNull();
    await user.type(screen.getByLabelText('Amount'), '1500');

    // The unissued draft is not offered; the oldest invoice is settled first.
    expect(screen.getByLabelText('Payment on INV-000001')).toHaveValue('300.00');
    expect(screen.getByLabelText('Payment on INV-000002')).toHaveValue('1,000.00');
    expect(screen.getByText('Applied to invoices').nextSibling).toHaveTextContent('$1,300.00');
    expect(screen.getByText('On account').nextSibling).toHaveTextContent('$200.00');

    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0]).toMatchObject({
      clientId: 'c1',
      bankAccountId: 'b1',
      amount: '1500.00',
      currency: 'USD',
      paymentMethod: 'BANK_TRANSFER',
      instrumentNumber: 'tt-2210',
      instrumentDate: '2026-10-30',
      issuer: 'Salaam Bank',
      payerName: 'Water Agency',
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
    expect(screen.getByLabelText('Payment on INV-000002')).toHaveValue('1,000.00');
    expect(screen.getByLabelText('Payment on INV-000001')).toHaveValue('0.00');

    await payByTransfer(user);
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0].allocations).toEqual([{ clientInvoiceId: 'i2', amount: 1000 }]);
  });

  it('refuses to apply more than was received', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await payByTransfer(user);
    await user.type(screen.getByLabelText('Amount'), '100');
    const line = screen.getByLabelText('Payment on INV-000002');
    await user.clear(line);
    await user.type(line, '50');
    expect(screen.getByRole('alert')).toHaveTextContent('Applied $150.00 is more than $100.00.');
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    expect(receivePayment).not.toHaveBeenCalled();
  });

  it('the only bank account taking receipts is chosen; ticking an invoice raises the amount to match', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await payByTransfer(user);
    await waitFor(() => expect(screen.getByLabelText('Received into')).toHaveTextContent(/Premier Bank/));

    await user.click(screen.getByRole('checkbox', { name: 'Pay INV-000002 in full' }));
    expect(screen.getByLabelText('Amount')).toHaveValue('1,000.00');
    expect(screen.getByLabelText('Payment on INV-000002')).toHaveValue('1,000.00');
    expect(screen.getByLabelText('Payment on INV-000001')).toHaveValue('0.00');

    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0]).toMatchObject({
      bankAccountId: 'b1',
      amount: '1000.00',
      allocations: [{ clientInvoiceId: 'i2', amount: 1000 }],
    });
  });

  it('needs the payment method, and the proof its method asks for', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await user.type(screen.getByLabelText('Amount'), '100');
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    expect(await screen.findByText('Choose how the client paid')).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: 'Cheque' }));
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    expect(screen.getAllByText('Required')).toHaveLength(4);
    expect(receivePayment).not.toHaveBeenCalled();
  });

  it('cash goes only into a cash box, with its receipt-book number and who counted it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await user.click(screen.getByRole('radio', { name: 'Cash' }));
    await user.click(screen.getByLabelText('Received into'));
    expect(screen.queryByRole('option', { name: /Premier Bank/ })).toBeNull();
    expect(screen.getByRole('option', { name: /Cash box/ })).toBeInTheDocument();
    await user.click(screen.getByRole('option', { name: /Cash box/ }));
    await user.type(screen.getByLabelText('Cash receipt-book no.'), 'CR-0091');
    await user.type(screen.getByLabelText('Counted by'), 'Amina');
    await user.type(screen.getByLabelText('Amount'), '50');
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0]).toMatchObject({
      bankAccountId: 'c1',
      paymentMethod: 'CASH',
      instrumentNumber: 'CR-0091',
      receivedBy: 'Amina',
    });
  });

  it('a cheque dated after today is saved on hand, applied to nothing yet', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await user.click(screen.getByRole('radio', { name: 'Cheque' }));
    await user.type(screen.getByLabelText('Cheque number'), '118204');
    await user.type(screen.getByLabelText('Drawn on (bank)'), 'Premier Bank');
    await user.type(screen.getByLabelText('Name on cheque'), 'Water Agency');
    await user.type(screen.getByLabelText('Cheque date'), '2099-11-15');
    await user.type(screen.getByLabelText('Amount'), '500');
    expect(await screen.findByText(/kept as a cheque on hand/)).toBeInTheDocument();
    expect(screen.queryByText('Apply to invoices')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Save cheque on hand' }));
    await waitFor(() => expect(receivePayment).toHaveBeenCalled());
    expect(receivePayment.mock.calls[0]![0]).toMatchObject({ paymentMethod: 'CHEQUE', instrumentDate: '2099-11-15', allocations: [] });
  });

  it('attaches the proof file to the saved receipt', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ReceiptForm />, { permissions: ['manage:receivable'] });
    await payByTransfer(user);
    await user.type(screen.getByLabelText('Amount'), '100');
    const file = new File(['advice'], 'advice.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Attach proof (optional)'), file);
    expect(screen.getByText('advice.pdf')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Receive payment' }));
    await waitFor(() => expect(upload.attach).toHaveBeenCalledWith('RECEIPT', 'r9', 'file-1'));
    expect(upload.uploadFile).toHaveBeenCalledWith(file);
    await waitFor(() => expect(push).toHaveBeenCalledWith('/receipts/r9'));
  });
});
