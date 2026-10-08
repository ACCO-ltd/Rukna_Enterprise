import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import type { BuyerAdvance } from '../types';

/**
 * The buyer advance detail after ADR-045 (P14): the GL journal link, settlements against bills
 * with their posting, Reverse with the server's refusal in words, and the legacy label.
 */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/procurement/advances/adv1' }));

const hooks = vi.hoisted(() => ({ advance: null as unknown, reverse: vi.fn() }));
vi.mock('../hooks/use-procurement', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useAllBuyerAdvances: vi.fn(),
  useGetBuyerAdvance: () => ({ isPending: false, isError: false, data: hooks.advance }),
  usePostBuyerAdvance: () => ({ mutate: vi.fn(), isPending: false, isError: false, error: null }),
}));
vi.mock('../api/quotation-payment-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  reverseBuyerAdvance: (...args: unknown[]) => hooks.reverse(...args),
}));

import { BuyerAdvanceDetail } from './buyer-advance-screens';

function advance(patch: Partial<BuyerAdvance> = {}): BuyerAdvance {
  return {
    id: 'adv1',
    purchaseOrder: { id: 'po1', poNumber: 'PO-00311' },
    organizationId: 'o1',
    purchaseOrderId: 'po1',
    recipientUserId: 'u-ahmed',
    amount: '1000.00',
    currencyCode: 'USD',
    paymentMethod: 'BANK',
    disbursementBankAccountId: 'ba-cash',
    reference: null,
    notes: null,
    advancedAt: '2026-10-08',
    documentStatus: 'APPROVED',
    postingStatus: 'POSTED',
    postedJournalEntryId: 'je-7',
    postedAt: '2026-10-08T08:00:00Z',
    postedBy: 'u-fo',
    createdBy: 'u-fo',
    createdAt: '2026-10-08T08:00:00Z',
    updatedAt: '2026-10-08T08:00:00Z',
    returns: [],
    evidenceAllocations: [],
    outstanding: '1000.00',
    quotationRequestId: 'qr1',
    ...patch,
  } as BuyerAdvance;
}

const PAYER = ['view:procurement', 'manage:payable'];

beforeEach(() => {
  vi.clearAllMocks();
  hooks.advance = advance();
});

describe('BuyerAdvanceDetail — ADR-045', () => {
  it('links the ledger journal and the quote request, and lists bills settled from the cash', () => {
    hooks.advance = advance({
      outstanding: '20.00',
      evidenceAllocations: [
        {
          id: 'app1',
          organizationId: 'o1',
          buyerAdvanceId: 'adv1',
          supplierBillId: 'b-91',
          billNumber: 'BILL-0091',
          allocatedAmount: '980.00',
          createdBy: 'u-fo',
          createdAt: '2026-10-08T10:00:00Z',
          allocationDate: '2026-10-08',
          postingStatus: 'POSTED',
          journalEntryId: 'je-8',
        },
      ],
    });
    renderWithProviders(<BuyerAdvanceDetail id="adv1" />, { permissions: PAYER });
    expect(screen.getByRole('link', { name: 'Open journal' })).toHaveAttribute('href', '/finance/accounting/journals/je-7');
    expect(screen.getByRole('link', { name: 'Open the quote request' })).toHaveAttribute('href', '/finance/quotes/qr1');
    expect(screen.getByText('Settled against bills')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: 'BILL-0091' })).toHaveAttribute('href', '/finance/accounting/bills/b-91');
    expect(screen.queryByText('Recorded before GL posting')).not.toBeInTheDocument();
  });

  it('labels a legacy advance, explains it and offers no reverse', () => {
    hooks.advance = advance({ postedJournalEntryId: null });
    renderWithProviders(<BuyerAdvanceDetail id="adv1" />, { permissions: PAYER });
    expect(screen.getByText('Recorded before GL posting')).toBeInTheDocument();
    expect(screen.getByText(/It is not re-posted/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });

  it('reverses with a reason, and says the server refusal in words', async () => {
    const user = userEvent.setup();
    hooks.reverse.mockRejectedValueOnce(
      new ApiError(409, 'Has settlements', 'CONFLICT', [], { code: 'ADVANCE_HAS_SETTLEMENTS' }),
    );
    renderWithProviders(<BuyerAdvanceDetail id="adv1" />, { permissions: PAYER });
    await user.click(screen.getByRole('button', { name: 'Reverse' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Store refused cash');
    await user.click(within(dialog).getByRole('button', { name: 'Reverse' }));
    await waitFor(() => expect(hooks.reverse).toHaveBeenCalledTimes(1));
    expect(hooks.reverse.mock.calls[0]![0]).toBe('adv1');
    expect(hooks.reverse.mock.calls[0]![1]).toMatchObject({ reason: 'Store refused cash' });
    expect(
      await within(dialog).findByText("Part of this cash is already settled or returned, so it can't be reversed."),
    ).toBeInTheDocument();
  });

  it('cancels a DRAFT advance stuck in approval with a reason and no date', async () => {
    const user = userEvent.setup();
    hooks.advance = advance({ documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', postedJournalEntryId: null });
    hooks.reverse.mockResolvedValueOnce({});
    renderWithProviders(<BuyerAdvanceDetail id="adv1" />, { permissions: PAYER });
    await user.click(screen.getByRole('button', { name: 'Cancel release' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByRole('textbox'), 'Store wants a bank transfer');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel release' }));
    await waitFor(() => expect(hooks.reverse).toHaveBeenCalledTimes(1));
    expect(hooks.reverse.mock.calls[0]![1]).toEqual({ reason: 'Store wants a bank transfer' });
  });

  it('offers no reverse without manage:payable', () => {
    renderWithProviders(<BuyerAdvanceDetail id="adv1" />, { permissions: ['view:procurement'] });
    expect(screen.queryByRole('button', { name: 'Reverse' })).not.toBeInTheDocument();
  });
});
