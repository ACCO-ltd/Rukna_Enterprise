import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { QuickAddInvoice } from './quick-add-invoice';

const mutateAsync = vi.fn();
vi.mock('../hooks/use-invoices', () => ({
  useIncomeAccounts: () => ({ data: [{ code: '42100', name: 'Equipment hire income', subtype: 'OTHER_INCOME' }] }),
  useSaveManualInvoice: () => ({ mutateAsync, isPending: false }),
}));
vi.mock('@/features/clients/hooks/use-clients', () => ({
  useClients: () => ({
    isPending: false,
    data: [{ id: 'c1', code: 'CL-1', name: 'Hargeisa Water Agency', status: 'ACTIVE', defaultCurrency: 'USD' }],
  }),
}));

beforeEach(() => mutateAsync.mockReset());

describe('QuickAddInvoice (ADR-047 list, ADR-048)', () => {
  it('saves a one-line sale draft dated today on Net 15, then closes', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    mutateAsync.mockResolvedValue({ id: 'inv-1' });
    renderWithProviders(<QuickAddInvoice onCreated={onCreated} />);

    await user.click(screen.getByRole('button', { name: /Quick add sale invoice/ }));
    await user.click(screen.getByRole('combobox', { name: /Client/ }));
    await user.click(await screen.findByRole('option', { name: /Hargeisa Water Agency/ }));
    await user.type(screen.getByLabelText('What it is for'), 'Generator hire');
    await user.type(screen.getByLabelText('Amount'), '1200{Enter}');

    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: 'c1',
        currencyCode: 'USD',
        paymentTerms: 'Net 15',
        lines: [{ description: 'Generator hire', quantity: '1', unitPrice: '1200', revenueAccountCode: '42100' }],
      }),
    );
    expect(onCreated).toHaveBeenCalledWith('inv-1');
    expect(screen.getByRole('button', { name: /Quick add sale invoice/ })).toBeInTheDocument();
  });

  it('says what is missing, and Esc cancels', async () => {
    const user = userEvent.setup();
    renderWithProviders(<QuickAddInvoice />);
    await user.click(screen.getByRole('button', { name: /Quick add sale invoice/ }));
    await user.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Choose a client');
    expect(mutateAsync).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('What it is for'), '{Escape}');
    expect(screen.getByRole('button', { name: /Quick add sale invoice/ })).toBeInTheDocument();
  });
});
