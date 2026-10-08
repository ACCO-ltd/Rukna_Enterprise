import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { rowFixture } from '../../quotations/test-fixtures';

const api = vi.hoisted(() => ({ list: vi.fn(), readiness: vi.fn() }));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listQuotationRequests: (...args: unknown[]) => api.list(...args),
}));
vi.mock('../../api/quotation-payment-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getBuyerCashReadiness: () => api.readiness(),
}));

import { PaymentsQueue } from './payments-queue';

const READY = { ready: true, staffAdvanceProfile: true, cashAccountsWithoutSignatories: 1, cashAccounts: [] };

beforeEach(() => {
  api.list.mockReset();
  api.readiness.mockReset();
  api.readiness.mockResolvedValue(READY);
  api.list.mockImplementation(async ({ queue }: { queue: string }) =>
    queue === 'pay'
      ? {
          items: [
            rowFixture({ id: 'a', paymentWaitingWorkingMinutes: 15, awardedTotal: '300.00' }),
            rowFixture({ id: 'b', paymentWaitingWorkingMinutes: 140, awardedTotal: '1000.00' }),
          ],
          total: 2,
        }
      : { items: [rowFixture({ id: 'c', paymentWaitingWorkingMinutes: 30 })], total: 1 },
  );
});

describe('PaymentsQueue — "Payments needed"', () => {
  it('lists orders to pay by payment wait, longest first, and receipts to settle on the second tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaymentsQueue />, { permissions: ['manage:payable'] });

    const links = await screen.findAllByRole('link', { name: /MR-/ });
    const hrefs = [...new Set(links.map((l) => l.getAttribute('href')))];
    expect(hrefs).toEqual(['/finance/quotes/b', '/finance/quotes/a']);
    expect(screen.getAllByText('2 h 20 m').length).toBeGreaterThan(0);
    expect(screen.getAllByText('$1,000.00').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: /To settle/ }));
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findAllByRole('link', { name: /MR-c/ })).not.toHaveLength(0);
    expect(api.list).toHaveBeenCalledWith({ queue: 'pay' });
    expect(api.list).toHaveBeenCalledWith({ queue: 'settle' });
  });

  it('says so when nothing is waiting', async () => {
    api.list.mockResolvedValue({ items: [], total: 0 });
    renderWithProviders(<PaymentsQueue />, { permissions: ['manage:payable'] });
    expect(await screen.findByText('Nothing to pay')).toBeInTheDocument();
  });

  it('shows the buyer-cash set-up checklist while something is missing, with links to fix it (P14)', async () => {
    api.readiness.mockResolvedValue({ ready: false, staffAdvanceProfile: true, cashAccountsWithoutSignatories: 0, cashAccounts: [] });
    renderWithProviders(<PaymentsQueue />, { permissions: ['manage:payable'] });
    expect(await screen.findByText('Buyer cash is not set up yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a cash box or EVC float' })).toHaveAttribute(
      'href',
      '/finance/accounting/bank-accounts?preset=cash-box',
    );
    expect(screen.queryByRole('link', { name: 'Set up staff advances' })).not.toBeInTheDocument();
  });

  it('hides the checklist once buyer cash is ready', async () => {
    renderWithProviders(<PaymentsQueue />, { permissions: ['manage:payable'] });
    await screen.findAllByRole('link', { name: /MR-/ });
    expect(screen.queryByText('Buyer cash is not set up yet')).not.toBeInTheDocument();
  });
});
