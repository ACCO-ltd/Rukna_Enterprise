import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { rowFixture } from '../../quotations/test-fixtures';

const api = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listQuotationRequests: (...args: unknown[]) => api.list(...args),
}));

import { PaymentsQueue } from './payments-queue';

beforeEach(() => {
  api.list.mockReset();
  api.list.mockImplementation(async ({ queue }: { queue: string }) =>
    queue === 'pay'
      ? {
          items: [
            rowFixture({ id: 'a', waitingWorkingMinutes: 15, slaTone: 'none', paymentState: 'READY_TO_PAY', supplierName: 'Hodan Hardware', remainingToFund: '300.00' }),
            rowFixture({ id: 'b', waitingWorkingMinutes: 140, slaTone: 'amber', paymentState: 'READY_TO_PAY', paymentPath: 'BUYER_CASH', supplierName: 'Bakaara Steel', remainingToFund: '1000.00' }),
          ],
          total: 2,
        }
      : {
          items: [rowFixture({ id: 'c', waitingWorkingMinutes: 30, slaTone: 'none', paymentState: 'RECEIPT_TO_RECORD', supplierName: 'Xamar Cement' })],
          total: 1,
        },
  );
});

describe('PaymentsQueue — "Payments needed"', () => {
  it('lists orders to pay, longest wait first, and receipts to settle on the second tab', async () => {
    const user = userEvent.setup();
    renderWithProviders(<PaymentsQueue />, { permissions: ['manage:payable'] });

    const links = await screen.findAllByRole('link', { name: /Steel|Hardware/ });
    const hrefs = [...new Set(links.map((l) => l.getAttribute('href')))];
    expect(hrefs).toEqual(['/finance/quotes/b', '/finance/quotes/a']);
    expect(screen.getAllByText('Over 2 h').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Ready to pay').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: /To settle/ }));
    const panel = screen.getByRole('tabpanel');
    expect(await within(panel).findAllByText('Receipt to record')).not.toHaveLength(0);
    expect(api.list).toHaveBeenCalledWith({ queue: 'pay' });
    expect(api.list).toHaveBeenCalledWith({ queue: 'settle' });
  });

  it('says so when nothing is waiting', async () => {
    api.list.mockResolvedValue({ items: [], total: 0 });
    renderWithProviders(<PaymentsQueue />, { permissions: ['manage:payable'] });
    expect(await screen.findByText('Nothing to pay')).toBeInTheDocument();
  });
});
