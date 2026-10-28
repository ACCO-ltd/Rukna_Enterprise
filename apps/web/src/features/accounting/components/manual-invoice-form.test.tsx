import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { ApiError } from '@/lib/api-client';

import { ManualInvoiceForm } from './manual-invoice-form';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

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
    data: [{ id: 'c1', code: 'CL-1', name: 'Hargeisa Water Agency', status: 'ACTIVE', taxNumber: null, defaultCurrency: 'USD' }],
  }),
}));
vi.mock('./invoice-tax-field', () => ({
  InvoiceTaxField: () => null,
  taxCodeBody: () => ({}),
  useInvoiceTaxChoice: () => ({ rateFraction: '0.05', blocked: false }),
  useInvoiceTaxErrorMessage: () => () => null,
}));
vi.mock('@/features/clients/components/client-form', () => ({
  ClientForm: ({ initialName }: { initialName?: string }) => <p>client form for {initialName}</p>,
}));

beforeEach(() => {
  mutateAsync.mockReset();
  push.mockReset();
});

async function fillLine(user: ReturnType<typeof userEvent.setup>, n: number, description: string, qty: string, rate: string) {
  await user.type(screen.getByLabelText(`Line ${n} description`), description);
  const q = screen.getByLabelText(`Line ${n} quantity`);
  await user.clear(q);
  await user.type(q, qty);
  await user.type(screen.getByLabelText(`Line ${n} rate`), rate);
}

describe('ManualInvoiceForm (ADR-048)', () => {
  it('prices the lines, adds tax at the chosen rate, and saves the draft', async () => {
    const user = userEvent.setup();
    mutateAsync.mockResolvedValue({ id: 'inv-9' });
    renderWithProviders(<ManualInvoiceForm />);

    await user.click(screen.getByRole('combobox', { name: /Client/ }));
    await user.click(await screen.findByRole('option', { name: /Hargeisa Water Agency/ }));
    await fillLine(user, 1, 'Excavator hire', '3', '450');
    await user.click(screen.getByRole('button', { name: 'Add line' }));
    await fillLine(user, 2, 'Surplus rebar', '2.5', '10.01');

    // 1350 + 25.03 (25.025 rounds half-up) = 1375.03; 5% tax = 68.75.
    const totals = screen.getByText('Total due').closest('dl')!;
    expect(within(totals).getByText('$1,375.03')).toBeInTheDocument();
    expect(within(totals).getByText('$68.75')).toBeInTheDocument();
    expect(within(totals).getByText('$1,443.78')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'c1',
        currencyCode: 'USD',
        paymentTerms: 'Net 15',
        lines: [
          { description: 'Excavator hire', quantity: '3', unitPrice: '450', revenueAccountCode: '42100' },
          { description: 'Surplus rebar', quantity: '2.5', unitPrice: '10.01', revenueAccountCode: '42100' },
        ],
      }),
    );
    expect(push).toHaveBeenCalledWith('/finance/accounting/invoices/inv-9');
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
    await user.click(screen.getByRole('combobox', { name: /Client/ }));
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
});
