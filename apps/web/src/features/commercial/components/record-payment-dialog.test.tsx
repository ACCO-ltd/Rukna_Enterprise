import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommercialInvoiceRow, DepositAccountOption } from '@erp/types';

import { chooseOption } from '@/test/choose-option';
import { renderWithProviders } from '@/test/render';

import * as commercialHooks from '../hooks/use-commercial';
import { toClientReceivableView, type ClientReceivableView } from '../lib/collection-view-model';
import { RecordPaymentDialog, type RecordPaymentDialogProps } from './record-payment-dialog';
import {
  allocationPayload,
  checkAllocations,
  payableInvoices,
  prefillAllocations,
} from './record-payment-dialog.model';

vi.mock('../hooks/use-commercial', () => ({
  useProjectDepositAccounts: vi.fn(),
  useRecordProjectPayment: vi.fn(),
}));

const TODAY = '2026-09-28';

const ACCOUNTS: DepositAccountOption[] = [
  { id: 'bank-1', bankName: 'Premier Bank', accountName: 'Main', accountNumber: '0001', currencyCode: 'USD' },
];

function row(overrides: Partial<CommercialInvoiceRow>): CommercialInvoiceRow {
  return {
    id: 'inv-x',
    invoiceNumber: 'INV-X',
    source: { kind: 'INSTALLMENT', label: 'Stage', id: 'inst-x' },
    invoiceDate: '2026-08-01',
    dueDate: '2026-09-01',
    currency: 'USD',
    subtotal: '1000.00',
    vatAmount: '50.00',
    totalAmount: '1050.00',
    paidAmount: '0.00',
    outstandingAmount: '1050.00',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    status: 'UNPAID',
    daysOverdue: 0,
    ...overrides,
  } as CommercialInvoiceRow;
}

const view = (overrides: Partial<CommercialInvoiceRow>): ClientReceivableView =>
  toClientReceivableView(row(overrides), TODAY);

// Listed newest-due first on purpose: the dialog must re-order them oldest due first.
const NEWER = view({ id: 'inv-new', invoiceNumber: 'INV-0003', dueDate: '2026-10-15', outstandingAmount: '300.00' });
const OLDEST = view({ id: 'inv-old', invoiceNumber: 'INV-0001', dueDate: '2026-08-15', outstandingAmount: '100.00' });
const MIDDLE = view({ id: 'inv-mid', invoiceNumber: 'INV-0002', dueDate: '2026-09-15', outstandingAmount: '200.00' });
const PAID = view({ id: 'inv-paid', invoiceNumber: 'INV-0000', status: 'PAID', outstandingAmount: '0.00', paidAmount: '1050.00' });

function stubHooks(mutate = vi.fn(), { isPending = false }: { isPending?: boolean } = {}) {
  vi.mocked(commercialHooks.useProjectDepositAccounts).mockReturnValue({
    data: ACCOUNTS,
    isPending: false,
  } as never);
  vi.mocked(commercialHooks.useRecordProjectPayment).mockReturnValue({
    mutate,
    reset: vi.fn(),
    isPending,
    isError: false,
    error: null,
  } as never);
  return mutate;
}

function renderDialog(overrides: Partial<RecordPaymentDialogProps> = {}) {
  const props: RecordPaymentDialogProps = {
    open: true,
    onOpenChange: vi.fn(),
    projectId: 'p1',
    currency: 'USD',
    preselectedInvoice: null,
    allInvoices: [NEWER, OLDEST, MIDDLE, PAID],
    ...overrides,
  };
  renderWithProviders(<RecordPaymentDialog {...props} />);
  return props;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('record-payment-dialog.model', () => {
  it('orders payable invoices oldest due first, the preselected one on top, and drops settled ones', () => {
    expect(payableInvoices([NEWER, OLDEST, MIDDLE, PAID]).map((i) => i.invoiceId)).toEqual([
      'inv-old',
      'inv-mid',
      'inv-new',
    ]);
    expect(payableInvoices([NEWER, OLDEST, MIDDLE], 'inv-new').map((i) => i.invoiceId)).toEqual([
      'inv-new',
      'inv-old',
      'inv-mid',
    ]);
  });

  it('prefills oldest first until the receipt runs out, then checks it in cents', () => {
    const invoices = payableInvoices([NEWER, OLDEST, MIDDLE]);
    const amounts = prefillAllocations(25000, invoices); // $250.00
    expect(amounts).toEqual({ 'inv-old': '100.00', 'inv-mid': '150.00', 'inv-new': '' });
    expect(checkAllocations('250.00', invoices, amounts)).toMatchObject({
      appliedMinor: 25000,
      unappliedMinor: 0,
      valid: true,
    });
    expect(checkAllocations('300.00', invoices, amounts).unappliedMinor).toBe(5000);
    expect(checkAllocations('200.00', invoices, amounts)).toMatchObject({ overApplied: true, valid: false });
    expect(
      checkAllocations('500.00', invoices, { 'inv-old': '100.01' }).lineErrors,
    ).toEqual({ 'inv-old': 'OVER_BALANCE' });
    expect(allocationPayload(invoices, amounts)).toEqual([
      { clientInvoiceId: 'inv-old', amount: 100 },
      { clientInvoiceId: 'inv-mid', amount: 150 },
    ]);
  });
});

describe('RecordPaymentDialog — a Dialog that applies a receipt oldest due first', () => {
  it('lists invoices oldest due first and prefills from the amount received', async () => {
    const user = userEvent.setup();
    stubHooks();
    renderDialog();

    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    const labels = within(dialog)
      .getAllByText(/^INV-000\d$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(['INV-0001', 'INV-0002', 'INV-0003']);

    await user.type(screen.getByLabelText('Amount received'), '250');
    expect(screen.getByLabelText('INV-0001')).toHaveValue('100.00');
    expect(screen.getByLabelText('INV-0002')).toHaveValue('150.00');
    expect(screen.getByLabelText('INV-0003')).toHaveValue('');
  });

  it('puts the invoice it was opened from first and prefills its balance', () => {
    stubHooks();
    renderDialog({ preselectedInvoice: NEWER });
    expect(screen.getByLabelText('Amount received')).toHaveValue('300.00');
    expect(screen.getByLabelText('INV-0003')).toHaveValue('300.00');
    expect(screen.getByLabelText('INV-0001')).toHaveValue('');
  });

  it('says what is not applied stays as client credit', async () => {
    const user = userEvent.setup();
    stubHooks();
    renderDialog({ preselectedInvoice: OLDEST });
    // $100 balance; receive $150 with only the oldest line kept.
    const amount = screen.getByLabelText('Amount received');
    await user.clear(amount);
    await user.type(amount, '150');
    await user.clear(screen.getByLabelText('INV-0002'));
    expect(screen.getByText('Unapplied $50.00 stays as client credit.')).toBeInTheDocument();
  });

  it('applied more than received: an inline error, and submit does not post', async () => {
    const user = userEvent.setup();
    const mutate = stubHooks();
    renderDialog({ preselectedInvoice: OLDEST });

    await chooseOption(user, screen.getByLabelText('Received into'), 'bank-1');
    await user.clear(screen.getByLabelText('INV-0002'));
    await user.type(screen.getByLabelText('INV-0002'), '50');
    expect(
      screen.getByText('Applied is more than the amount received. Reduce a line or raise the amount received.'),
    ).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Record payment' }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('a line above its balance is flagged', async () => {
    const user = userEvent.setup();
    stubHooks();
    renderDialog({ preselectedInvoice: OLDEST });
    const line = screen.getByLabelText('INV-0001');
    await user.clear(line);
    await user.type(line, '120');
    expect(screen.getByText("More than this invoice's balance.")).toBeInTheDocument();
  });

  it('posts the receipt with its allocations and an idempotency key', async () => {
    const user = userEvent.setup();
    const mutate = stubHooks();
    renderDialog();

    await chooseOption(user, screen.getByLabelText('Received into'), 'bank-1');
    await user.type(screen.getByLabelText('Amount received'), '350');
    await user.type(screen.getByLabelText('Bank reference'), 'TT-7781');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(mutate).toHaveBeenCalledTimes(1);
    const payload = mutate.mock.calls[0]![0];
    expect(payload).toMatchObject({
      bankAccountId: 'bank-1',
      amount: '350.00',
      currency: 'USD',
      reference: 'TT-7781',
      allocations: [
        { clientInvoiceId: 'inv-old', amount: 100 },
        { clientInvoiceId: 'inv-mid', amount: 200 },
        { clientInvoiceId: 'inv-new', amount: 50 },
      ],
    });
    expect(typeof payload.idempotencyKey).toBe('string');
    expect(payload.idempotencyKey.length).toBeGreaterThan(8);
    expect(payload.receiptDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('asks for the account in words instead of a disabled button', async () => {
    const user = userEvent.setup();
    const mutate = stubHooks();
    renderDialog({ preselectedInvoice: OLDEST });
    const submit = screen.getByRole('button', { name: 'Record payment' });
    expect(submit).toBeEnabled();
    await user.click(submit);
    expect(screen.getByText('Choose the account the money was received into.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('money-blind: no form and never $0', () => {
    stubHooks();
    const hidden = view({ id: 'inv-h', outstandingAmount: null, totalAmount: null, paidAmount: null });
    renderDialog({ allInvoices: [hidden], preselectedInvoice: hidden });
    expect(
      screen.getByText("Amounts are hidden for your role, so payments can't be recorded here."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Amount received')).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });
});

describe('RecordPaymentDialog — dismissal (ADR-039 FormDialog)', () => {
  it('closes straight away when nothing was changed', async () => {
    const user = userEvent.setup();
    stubHooks();
    const props = renderDialog({ preselectedInvoice: OLDEST });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
    expect(screen.queryByText('Discard unsaved changes?')).not.toBeInTheDocument();
  });

  it('asks before discarding a half-entered receipt', async () => {
    const user = userEvent.setup();
    stubHooks();
    const props = renderDialog({ preselectedInvoice: OLDEST });

    await user.type(screen.getByLabelText('Bank reference'), 'TT-1');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('Discard unsaved changes?')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('cannot be dismissed while the receipt is being recorded', async () => {
    const user = userEvent.setup();
    stubHooks(vi.fn(), { isPending: true });
    const props = renderDialog({ preselectedInvoice: OLDEST });

    expect(screen.getByRole('button', { name: 'Recording…' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Close' })).toBeDisabled();
    await user.keyboard('{Escape}');
    expect(props.onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps the title and the primary in the fixed header and footer', () => {
    stubHooks();
    renderDialog({ preselectedInvoice: OLDEST });
    const dialog = screen.getByRole('dialog', { name: 'Record payment' });
    const body = dialog.querySelector('[data-form-dialog-body]');
    expect(body).not.toBeNull();
    // The primary sits outside the scrolling body, so it never scrolls away.
    expect(body!.contains(screen.getByRole('button', { name: 'Record payment' }))).toBe(false);
  });
});
