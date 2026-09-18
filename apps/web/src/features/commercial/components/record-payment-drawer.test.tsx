import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommercialInvoiceRow, DepositAccountOption } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';

import { toClientReceivableView, type ClientReceivableView } from '../lib/collection-view-model';
import * as commercialHooks from '../hooks/use-commercial';
import { RecordPaymentDrawer, type RecordPaymentDrawerProps } from './record-payment-drawer';

vi.mock('../hooks/use-commercial', () => ({
  useProjectDepositAccounts: vi.fn(),
  useRecordProjectPayment: vi.fn(),
  commercialKeys: {
    billing: (id: string) => ['commercial', id, 'billing'],
  },
}));

// ─── Factories ───────────────────────────────────────────────────────────────

const TODAY = '2026-09-17';

const MOCK_BANK_ACCOUNTS: DepositAccountOption[] = [
  {
    id: 'bank-1',
    bankName: 'Alinma Bank',
    accountName: 'Main Account',
    accountNumber: 'SA11-0000-0001',
    currencyCode: 'SAR',
  },
  {
    id: 'bank-2',
    bankName: 'Riyad Bank',
    accountName: 'Operations',
    accountNumber: 'SA22-0000-0002',
    currencyCode: 'SAR',
  },
];

function makeInvoiceRow(overrides: Partial<CommercialInvoiceRow> = {}): CommercialInvoiceRow {
  return {
    id: 'inv-1',
    invoiceNumber: 'INV-0001',
    source: { kind: 'INSTALLMENT', label: null, id: 'inst-1' },
    invoiceDate: '2026-08-01',
    dueDate: '2026-10-01',
    currency: 'USD',
    subtotal: '100000.00',
    vatAmount: '5000.00',
    totalAmount: '105000.00',
    paidAmount: '0.00',
    outstandingAmount: '105000.00',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    status: 'UNPAID',
    daysOverdue: 0,
    ...overrides,
  } as CommercialInvoiceRow;
}

function makeReceivable(overrides: Partial<CommercialInvoiceRow> = {}): ClientReceivableView {
  return toClientReceivableView(makeInvoiceRow(overrides), TODAY);
}

function makeDrawerProps(
  overrides: Partial<RecordPaymentDrawerProps> = {},
): RecordPaymentDrawerProps {
  const invoice = makeReceivable();
  return {
    open: true,
    onOpenChange: vi.fn(),
    projectId: 'p-1',
    currency: 'USD',
    preselectedInvoice: invoice,
    allInvoices: [invoice],
    ...overrides,
  };
}

function renderDrawer(props: RecordPaymentDrawerProps) {
  return renderWithProviders(<RecordPaymentDrawer {...props} />, { permissions: [] });
}

// ─── Stub helpers ─────────────────────────────────────────────────────────────

function stubDepositAccounts(data: DepositAccountOption[] = MOCK_BANK_ACCOUNTS) {
  vi.mocked(commercialHooks.useProjectDepositAccounts).mockReturnValue({
    data,
    isPending: false,
    isError: false,
  } as never);
}

function stubMutation(mutate = vi.fn()) {
  vi.mocked(commercialHooks.useRecordProjectPayment).mockReturnValue({
    mutate,
    reset: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
    error: null,
  } as never);
  return mutate;
}

beforeEach(() => {
  vi.clearAllMocks();
  stubDepositAccounts();
  stubMutation();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('RecordPaymentDrawer', () => {
  it('renders the drawer title and form fields', () => {
    renderDrawer(makeDrawerProps());
    expect(screen.getByText('Record payment')).toBeInTheDocument();
    expect(screen.getByLabelText('Deposit account')).toBeInTheDocument();
    expect(screen.getByLabelText('Amount received')).toBeInTheDocument();
    expect(screen.getByLabelText('Date received')).toBeInTheDocument();
  });

  it('shows deposit account options when the selector is opened', async () => {
    const user = userEvent.setup();
    renderDrawer(makeDrawerProps());
    const trigger = screen.getByLabelText('Deposit account');
    await user.click(trigger);
    expect(await screen.findByRole('option', { name: /Alinma Bank/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Riyad Bank/ })).toBeInTheDocument();
  });

  it('shows allocation preview for a single invoice with default outstanding amount', () => {
    const invoice = makeReceivable({ outstandingAmount: '105000.00' });
    renderDrawer(makeDrawerProps({ allInvoices: [invoice], preselectedInvoice: invoice }));
    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    expect(screen.getByText('Allocated')).toBeInTheDocument();
  });

  it('distributes one payment across two invoices in the allocation preview (spec §15 test 6)', async () => {
    const user = userEvent.setup();
    const inv1 = makeReceivable({ id: 'inv-a', invoiceNumber: 'INV-0001', outstandingAmount: '40000.00' });
    const inv2 = makeReceivable({ id: 'inv-b', invoiceNumber: 'INV-0002', outstandingAmount: '30000.00' });
    renderDrawer(makeDrawerProps({ allInvoices: [inv1, inv2], preselectedInvoice: inv1 }));

    const amountInput = screen.getByLabelText('Amount received');
    await user.clear(amountInput);
    await user.type(amountInput, '60000');

    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    expect(screen.getByText('INV-0002')).toBeInTheDocument();
  });

  it('total suggested allocation does not exceed receipt amount (spec §15 test 7)', async () => {
    const user = userEvent.setup();
    const inv1 = makeReceivable({ id: 'inv-a', invoiceNumber: 'INV-0001', outstandingAmount: '40000.00' });
    const inv2 = makeReceivable({ id: 'inv-b', invoiceNumber: 'INV-0002', outstandingAmount: '30000.00' });
    renderDrawer(makeDrawerProps({ allInvoices: [inv1, inv2], preselectedInvoice: inv1 }));

    const amountInput = screen.getByLabelText('Amount received');
    await user.clear(amountInput);
    await user.type(amountInput, '50000');

    expect(screen.getByText('INV-0001')).toBeInTheDocument();
    expect(screen.queryByText('Unallocated')).not.toBeInTheDocument();
  });

  it('per-invoice allocation is capped at its outstanding — never exceeds max (spec §15 test 8)', async () => {
    const user = userEvent.setup();
    const invoice = makeReceivable({ outstandingAmount: '20000.00', invoiceNumber: 'INV-0001' });
    renderDrawer(makeDrawerProps({ allInvoices: [invoice], preselectedInvoice: invoice }));

    const amountInput = screen.getByLabelText('Amount received');
    await user.clear(amountInput);
    await user.type(amountInput, '50000');

    expect(screen.getByText('Unallocated')).toBeInTheDocument();
  });

  it('shows Unallocated line when amount exceeds total invoice outstanding (spec §15 test 9)', async () => {
    const user = userEvent.setup();
    const invoice = makeReceivable({ outstandingAmount: '60000.00' });
    renderDrawer(makeDrawerProps({ allInvoices: [invoice], preselectedInvoice: invoice }));

    const amountInput = screen.getByLabelText('Amount received');
    await user.clear(amountInput);
    await user.type(amountInput, '100000');

    expect(screen.getByText('Unallocated')).toBeInTheDocument();
    expect(screen.getByText('Unallocated amount goes to client unapplied cash.')).toBeInTheDocument();
  });

  it('submit button is disabled when no bank account is selected', () => {
    const invoice = makeReceivable({ outstandingAmount: '50000.00' });
    renderDrawer(makeDrawerProps({ preselectedInvoice: invoice, allInvoices: [invoice] }));
    expect(screen.getByRole('button', { name: 'Save payment' })).toBeDisabled();
  });

  it('calls mutation.mutate with bankAccountId and allocations on submit', async () => {
    const user = userEvent.setup();
    const mutate = stubMutation();

    const invoice = makeReceivable({ id: 'inv-1', invoiceNumber: 'INV-0001', outstandingAmount: '50000.00' });
    renderDrawer(makeDrawerProps({ preselectedInvoice: invoice, allInvoices: [invoice] }));

    await chooseOption(user, screen.getByLabelText('Deposit account'), 'bank-1');

    const amountInput = screen.getByLabelText('Amount received');
    await user.clear(amountInput);
    await user.type(amountInput, '50000');

    await user.type(screen.getByLabelText('Reference'), 'TT-999');
    await user.click(screen.getByRole('button', { name: 'Save payment' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        bankAccountId: 'bank-1',
        amount: '50000',
        currency: 'USD',
        reference: 'TT-999',
        allocations: expect.arrayContaining([
          expect.objectContaining({ clientInvoiceId: 'inv-1' }),
        ]),
      }),
      expect.anything(),
    );
  });

  it('closes the drawer when onSuccess callback is invoked', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const mutate = vi.fn().mockImplementation((_payload: unknown, opts: { onSuccess?: () => void }) => {
      opts?.onSuccess?.();
    });
    stubMutation(mutate);

    const invoice = makeReceivable({ outstandingAmount: '50000.00' });
    renderDrawer(makeDrawerProps({ onOpenChange, preselectedInvoice: invoice, allInvoices: [invoice] }));

    await chooseOption(user, screen.getByLabelText('Deposit account'), 'bank-1');

    const amountInput = screen.getByLabelText('Amount received');
    await user.clear(amountInput);
    await user.type(amountInput, '50000');

    await user.click(screen.getByRole('button', { name: 'Save payment' }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
