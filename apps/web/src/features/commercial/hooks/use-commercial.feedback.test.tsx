import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import { useRecordProjectPayment } from './use-commercial';

const api = vi.hoisted(() => ({ recordProjectPayment: vi.fn() }));
vi.mock('../api/commercial-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/commercial-api')>()),
  recordProjectPayment: api.recordProjectPayment,
}));

function RecordProbe() {
  const record = useRecordProjectPayment('p1');
  return (
    <button
      type="button"
      onClick={() =>
        record.mutate({
          receiptDate: '2026-09-30',
          amount: '125000.00',
          depositAccountId: 'acc-1',
          allocations: [],
        } as unknown as Parameters<typeof record.mutate>[0])
      }
    >
      Record
    </button>
  );
}

describe('commercial mutation feedback', () => {
  it('confirms a recorded payment without naming the amount', async () => {
    api.recordProjectPayment.mockResolvedValue({
      receiptId: 'rcpt-1',
      receiptDate: '2026-09-30',
      amount: '125000.00',
      currency: 'USD',
      method: null,
      reference: null,
      allocations: [],
      unallocatedAmount: '0.00',
    });
    renderWithProviders(<RecordProbe />, { withToast: true });

    await userEvent.click(screen.getByRole('button', { name: 'Record' }));

    const toast = await screen.findByText('Payment recorded');
    expect(toast).toBeInTheDocument();
    // Project managers and site engineers are money-blind: the toast never carries the figure.
    expect(screen.queryByText(/125,?000/)).not.toBeInTheDocument();
  });
});
