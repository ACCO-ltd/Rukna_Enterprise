import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/** The Buyer advances page lists the organisation's advances with their order and supplier. */

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/procurement/advances' }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const hooks = vi.hoisted(() => ({ all: vi.fn() }));
vi.mock('../hooks/use-procurement', () => ({
  useAllBuyerAdvances: () => hooks.all(),
  useGetBuyerAdvance: vi.fn(),
  usePostBuyerAdvance: vi.fn(),
}));

import { BuyerAdvancesList } from './buyer-advance-screens';

beforeEach(() => vi.clearAllMocks());

describe('BuyerAdvancesList', () => {
  it('shows each advance with its PO number as a link and its supplier', async () => {
    hooks.all.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: [
        {
          id: 'adv1',
          purchaseOrderId: 'po1',
          purchaseOrder: { id: 'po1', poNumber: 'PO-2026-0007' },
          supplier: { id: 's1', name: 'Bakaal Steel' },
          amount: '500.00',
          outstanding: '200.00',
          currencyCode: 'USD',
          advancedAt: '2026-09-30',
          reference: 'Cash to Omar',
          postingStatus: 'POSTED',
        },
      ],
    });
    renderWithProviders(<BuyerAdvancesList />);

    const grid = within(await screen.findByRole('table'));
    expect(grid.getByRole('link', { name: 'PO-2026-0007' })).toHaveAttribute('href', '/procurement/orders/po1');
    expect(grid.getByText('Bakaal Steel')).toBeInTheDocument();
    expect(grid.getByText('$500.00')).toBeInTheDocument();
    expect(grid.getByText('Cash to Omar')).toBeInTheDocument();
  });

  it('labels an advance posted before buyer cash reached the ledger (ADR-045 legacy)', async () => {
    hooks.all.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: [
        {
          id: 'adv-old',
          purchaseOrderId: 'po1',
          purchaseOrder: { id: 'po1', poNumber: 'PO-2026-0001' },
          amount: '300.00',
          outstanding: '300.00',
          currencyCode: 'USD',
          advancedAt: '2026-09-01',
          postingStatus: 'POSTED',
          postedJournalEntryId: null,
        },
        {
          id: 'adv-new',
          purchaseOrderId: 'po2',
          purchaseOrder: { id: 'po2', poNumber: 'PO-2026-0002' },
          amount: '400.00',
          outstanding: '0.00',
          currencyCode: 'USD',
          advancedAt: '2026-10-08',
          postingStatus: 'POSTED',
          postedJournalEntryId: 'je-1',
        },
      ],
    });
    renderWithProviders(<BuyerAdvancesList />);
    const grid = within(await screen.findByRole('table'));
    expect(grid.getAllByText('Recorded before GL posting')).toHaveLength(1);
  });

  it('shows a cancelled advance as cancelled, holding nothing — not "Not posted / outstanding"', async () => {
    hooks.all.mockReturnValue({
      isPending: false,
      isError: false,
      refetch: vi.fn(),
      data: [
        {
          id: 'adv-c',
          purchaseOrderId: 'po1',
          purchaseOrder: { id: 'po1', poNumber: 'PO-2026-0009' },
          amount: '900.00',
          outstanding: '900.00',
          currencyCode: 'USD',
          advancedAt: '2026-10-08',
          documentStatus: 'CANCELLED',
          postingStatus: 'NOT_POSTED',
          postedJournalEntryId: null,
        },
      ],
    });
    renderWithProviders(<BuyerAdvancesList />);
    const grid = within(await screen.findByRole('table'));
    expect(grid.getByText('Cancelled')).toBeInTheDocument();
    // The amount is shown once (the advance); the outstanding cell holds nothing.
    expect(grid.getAllByText('$900.00')).toHaveLength(1);
    expect(grid.getAllByText('—').length).toBeGreaterThan(0);
    expect(grid.queryByText('Not posted')).not.toBeInTheDocument();
  });

  it('shows the empty state when the organisation has none', async () => {
    hooks.all.mockReturnValue({ isPending: false, isError: false, refetch: vi.fn(), data: [] });
    renderWithProviders(<BuyerAdvancesList />);
    expect(await screen.findByText('No buyer advances recorded')).toBeInTheDocument();
  });
});
