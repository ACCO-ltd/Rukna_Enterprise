import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/** AR-5 — the refund dialog follows the payment rule and never pays back more than is on account. */
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('./refunds', () => ({
  useRequestRefund: () => ({ mutate: mocks.request, reset: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('@/features/accounting/hooks/use-accounting', async (original) => ({
  ...(await original<object>()),
  useBankAccounts: () => ({
    data: [
      { id: 'b1', bankName: 'Dahabshiil', accountName: 'Operating', currencyCode: 'USD', status: 'ACTIVE', allowsPayments: true },
      { id: 'b2', bankName: 'Premier', accountName: 'Receipts only', currencyCode: 'USD', status: 'ACTIVE', allowsPayments: false },
    ],
  }),
}));

import { RefundDialog } from './refund-dialog';

beforeEach(() => vi.clearAllMocks());

describe('RefundDialog', () => {
  it('posts at once up to the payment limit, from a bank that pays', async () => {
    const user = userEvent.setup();
    renderWithProviders(<RefundDialog open onOpenChange={vi.fn()} receiptId="r1" onAccount="250.00" currencyCode="USD" approvedUpTo="1000.00" />);
    expect(screen.getByText(/It posts now/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Refund' }));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(screen.getByText('Choose the bank account the money is paid from.')).toBeInTheDocument();
  });

  it('says a refund above the limit goes to Approvals', () => {
    renderWithProviders(<RefundDialog open onOpenChange={vi.fn()} receiptId="r1" onAccount="1500.00" currencyCode="USD" approvedUpTo="1000.00" />);
    expect(screen.getByText('This goes to Approvals first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send for approval' })).toBeInTheDocument();
  });
});
