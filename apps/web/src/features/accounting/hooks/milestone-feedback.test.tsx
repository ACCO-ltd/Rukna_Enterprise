import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { usePeriodAction } from './use-accounting';
import { useInvoiceAction } from './use-invoices';

/**
 * Posting an invoice and closing a period (or the year) are the milestones: they open the
 * success dialog. The other transitions of the same hooks get an ordinary toast.
 */

const accountingApi = vi.hoisted(() => ({
  lockPeriod: vi.fn(),
  closePeriod: vi.fn(),
  closeFiscalYear: vi.fn(),
}));
const invoicesApi = vi.hoisted(() => ({
  approveInvoice: vi.fn(),
  postInvoice: vi.fn(),
}));

vi.mock('../api/accounting-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...accountingApi,
}));
vi.mock('../api/invoices-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...invoicesApi,
}));

function Periods() {
  const action = usePeriodAction();
  return (
    <>
      <button type="button" onClick={() => action.mutate({ type: 'lock', periodId: 'p-1' })}>
        Lock
      </button>
      <button type="button" onClick={() => action.mutate({ type: 'close', periodId: 'p-1' })}>
        Close
      </button>
      <button
        type="button"
        onClick={() => action.mutate({ type: 'close-year', fiscalYearId: 'fy-1' })}
      >
        Close year
      </button>
      <output aria-label="pending">{String(action.isPending)}</output>
    </>
  );
}

function Invoice() {
  const action = useInvoiceAction('inv-1');
  return (
    <>
      <button type="button" onClick={() => action.mutate({ type: 'approve' })}>
        Approve
      </button>
      <button type="button" onClick={() => action.mutate({ type: 'post', payload: {} as never })}>
        Post
      </button>
    </>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('period feedback', () => {
  it('toasts a lock', async () => {
    accountingApi.lockPeriod.mockResolvedValue({ id: 'p-1', name: 'September 2026' });
    renderWithProviders(<Periods />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Lock' }));

    expect(await screen.findByText('Period September 2026 locked')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the success dialog when a period closes', async () => {
    accountingApi.closePeriod.mockResolvedValue({ id: 'p-1', name: 'September 2026' });
    renderWithProviders(<Periods />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Close' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Period September 2026 closed');
    expect(dialog).toHaveTextContent(/accepts no further postings/);
    expect(screen.getByLabelText('pending')).toHaveTextContent('false');
  });

  it('opens the success dialog when the year closes', async () => {
    accountingApi.closeFiscalYear.mockResolvedValue(undefined);
    renderWithProviders(<Periods />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Close year' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Fiscal year closed');
    expect(dialog).toHaveTextContent(/retained earnings/);
  });
});

describe('invoice feedback', () => {
  it('toasts an approval', async () => {
    invoicesApi.approveInvoice.mockResolvedValue({ id: 'inv-1', invoiceNumber: null });
    renderWithProviders(<Invoice />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Approve' }));

    expect(await screen.findByText('Invoice approved')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the success dialog when the invoice posts, naming its new number', async () => {
    invoicesApi.postInvoice.mockResolvedValue({ id: 'inv-1', invoiceNumber: 'INV-0042' });
    renderWithProviders(<Invoice />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Post' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Invoice INV-0042 posted');
    expect(dialog).toHaveTextContent(/Record a receipt/);
  });
});
