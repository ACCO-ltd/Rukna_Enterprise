import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';

import { ManualInvoiceForm } from './manual-invoice-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }), useSearchParams: () => null }));

const mutateAsync = vi.fn();
vi.mock('../hooks/use-invoices', () => ({
  useIncomeAccounts: () => ({
    data: [
      { code: '42100', name: 'Equipment hire income', subtype: 'OTHER_INCOME' },
      { code: '42200', name: 'Sale of surplus materials', subtype: 'OTHER_INCOME' },
    ],
  }),
  useSaveManualInvoice: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({
    isPending: false,
    refetch: vi.fn(),
    data: [
      { id: 'c1', code: 'CL-1', name: 'Hargeisa Water Agency', status: 'ACTIVE', taxNumber: null, defaultCurrency: 'USD' },
      // A client set up with another default currency, and its own 30-day terms.
      { id: 'c2', code: 'CL-2', name: 'Berbera Port Authority', status: 'ACTIVE', taxNumber: null, defaultCurrency: 'EUR', paymentTermsDays: 30 },
    ],
  }),
}));
const approval = vi.hoisted(() => ({ above: null as string | null }));
vi.mock('../hooks/use-accounting', () => ({
  useApprovalSettings: () => ({ data: { invoiceApprovalAbove: approval.above }, isSuccess: true }),
}));
vi.mock('@/features/finance/hooks/use-accounting-readiness', () => ({ useLedgerBlocked: () => false }));
vi.mock('@/features/clients/components/client-form', () => ({
  ClientForm: ({ initialName }: { initialName?: string }) => <p>client form for {initialName}</p>,
}));

beforeEach(() => {
  mutateAsync.mockReset();
  push.mockReset();
  approval.above = null;
});

async function fillLine(user: ReturnType<typeof userEvent.setup>, n: number, description: string, qty: string, rate: string) {
  await user.type(screen.getByLabelText(`Line ${n} description`), description);
  const q = screen.getByLabelText(`Line ${n} quantity`);
  await user.clear(q);
  await user.type(q, qty);
  await user.type(screen.getByLabelText(`Line ${n} rate`), rate);
}

describe('ManualInvoiceForm (ADR-048)', () => {
  it('prices the lines and saves the draft', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ id: 'inv-9' });
    renderWithProviders(<ManualInvoiceForm />);

    await user.click(screen.getByRole('combobox', { name: /Bill to/ }));
    await user.click(await screen.findByRole('option', { name: /Hargeisa Water Agency/ }));
    await fillLine(user, 1, 'Excavator hire', '3', '450');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await fillLine(user, 2, 'Surplus rebar', '2.5', '10.01');
    await user.type(screen.getByLabelText('PO / reference'), ' PO-4471 ');
    await user.type(screen.getByLabelText('Note to client'), 'Hire for site B.');

    // 1350 + 25.03 (25.025 rounds half-up) = 1375.03.
    const totals = screen.getByText('Total due').closest('dl')!;
    expect(within(totals).getByText('$1,375.03')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'c1',
        currencyCode: 'USD',
        paymentTerms: 'Net 15',
        clientReference: 'PO-4471',
        notes: 'Hire for site B.',
        lines: [
          { description: 'Excavator hire', quantity: '3', unitPrice: '450', revenueAccountCode: '42100' },
          { description: 'Surplus rebar', quantity: '2.5', unitPrice: '10.01', revenueAccountCode: '42100' },
        ],
      }),
    );
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/inv-9');
  });

  it('CI-1/CI-6: bills in USD whatever the client’s default, takes the client’s terms, and Save and issue opens Issue', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ id: 'inv-10' });
    renderWithProviders(<ManualInvoiceForm />);

    expect(screen.queryByLabelText('Currency')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /Bill to/ }));
    await user.click(await screen.findByRole('option', { name: /Berbera Port Authority/ }));
    expect(screen.getByRole('radio', { name: 'Net 30' })).toHaveAttribute('aria-checked', 'true');
    await fillLine(user, 1, 'Crane hire', '1', '100');

    await user.click(screen.getByRole('button', { name: 'Save and issue' }));
    expect(mutateAsync).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'c2', currencyCode: 'USD', paymentTerms: 'Net 30' }));
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/inv-10?issue=1');
  });

  it('offers only Save draft when the total needs a second person’s approval', async () => {
    approval.above = '50.00';
    const user = userEvent.setup();
    renderWithProviders(<ManualInvoiceForm />);
    await fillLine(user, 1, 'Crane hire', '1', '100');
    expect(screen.queryByRole('button', { name: 'Save and issue' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save draft' })).toBeInTheDocument();
  });

  it('lists what is missing instead of saving', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManualInvoiceForm />);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Choose a client.')).toBeInTheDocument();
    expect(screen.getByText('Line 1 needs a description.')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("shows the server's problems when it refuses", async () => {
    const user = userEvent.setup();
    mutateAsync.mockRejectedValue(
      new ApiError(400, 'x', 'MANUAL_INVOICE_INVALID', [], { problems: ['42100 is not an active income account that accepts postings.'] }),
    );
    renderWithProviders(<ManualInvoiceForm />);
    await user.click(screen.getByRole('combobox', { name: /Bill to/ }));
    await user.click(await screen.findByRole('option', { name: /Hargeisa Water Agency/ }));
    await fillLine(user, 1, 'Hire', '1', '10');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(await screen.findByText('42100 is not an active income account that accepts postings.')).toBeInTheDocument();
  });

  it('works out the due date from the terms', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManualInvoiceForm />);
    await user.click(screen.getByRole('radio', { name: 'Net 30' }));
    expect(screen.getByRole('radio', { name: 'Net 30' })).toHaveAttribute('aria-checked', 'true');
  });

  it('links each problem in the summary to its field (ADR-037 form kit)', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManualInvoiceForm />);
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByText('Fix 3 fields before saving')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Line 1 description' }));
    expect(screen.getByLabelText('Line 1 description')).toHaveFocus();
  });

  it('adds a line on Enter in the last line and never submits from a line', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManualInvoiceForm />);
    await user.type(screen.getByLabelText('Line 1 rate'), '10{Enter}');
    expect(screen.getByLabelText('Line 2 description')).toBeInTheDocument();
    expect(mutateAsync).not.toHaveBeenCalled();
    expect(screen.queryByText('Choose a client.')).toBeNull();
  });

  it('asks before discarding typed changes', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ManualInvoiceForm />);
    await user.type(screen.getByLabelText('Line 1 description'), 'Hire');
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });
});
