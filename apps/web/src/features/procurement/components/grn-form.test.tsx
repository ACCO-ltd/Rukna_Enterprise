import { screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import type { ReceivablePurchaseOrder } from '../types';

/**
 * Receive a delivery: lines prefilled with what is still due, problems reported per line,
 * over-receipt explained (never blocked), Post receipt confirmed, then create + post. Separation
 * of duties is the server's verdict — the screen explains it and offers an exception.
 */

const routerMocks = vi.hoisted(() => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => routerMocks,
  usePathname: () => '/procurement/grn/new',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const hooks = vi.hoisted(() => ({
  receivable: vi.fn(),
  create: vi.fn(),
  post: vi.fn(),
  requestException: vi.fn(),
}));

const ORDER = {
  id: 'po1',
  poNumber: 'PO-2026-0007',
  status: 'OPEN',
  supplier: { id: 's1', name: 'Bakaal Steel' },
  revisions: [
    {
      id: 'r1',
      revisionNumber: 1,
      status: 'ACTIVE',
      lines: [
        {
          id: 'l1',
          description: 'Cement 50kg',
          orderedQuantity: '100',
          unitPrice: '10.00',
          material: { code: 'CM-50', name: 'Cement 50kg' },
          uom: { code: 'BAG', symbol: 'bag' },
          project: { id: 'p1', code: 'P1', name: 'Hodan villa' },
        },
      ],
    },
  ],
};

vi.mock('../hooks/use-procurement', () => ({
  useReceivablePurchaseOrders: () => hooks.receivable(),
  // The order detail is read only for its unit prices (money-visible viewers).
  usePurchaseOrder: (id: string) => (id ? { data: ORDER, isPending: false, isError: false } : { isPending: false }),
  useCreateGoodsReceipt: () => ({ mutateAsync: hooks.create }),
  usePostGoodsReceipt: () => ({ mutateAsync: hooks.post }),
  useCreateReceiptException: () => ({
    mutate: hooks.requestException,
    reset: vi.fn(),
    isPending: false,
    error: null,
  }),
  // Used by the list and detail in the same module; not by the form.
  useGoodsReceipts: vi.fn(),
  useGoodsReceipt: vi.fn(),
  usePurchaseOrders: vi.fn(),
  useSuppliers: vi.fn(),
  useCancelGoodsReceipt: vi.fn(),
  useApproveGoodsReceiptException: vi.fn(),
}));

import { GrnForm } from './grn-screens';

const MONEY = 'view:commitment-ledger';
const loaded = (data: ReceivablePurchaseOrder[]) => ({ data, isPending: false, isError: false, refetch: vi.fn() });

/** The receivable read: open lines, no prices, and the server's receive verdict. */
const receivable = (patch: Partial<ReceivablePurchaseOrder> = {}): ReceivablePurchaseOrder => ({
  id: 'po1',
  poNumber: 'PO-2026-0007',
  status: 'OPEN',
  supplier: { id: 's1', name: 'Bakaal Steel' },
  activeRevisionId: 'r1',
  activeRevisionNumber: 1,
  expectedDeliveryDate: null,
  projects: [{ id: 'p1', code: 'P1', name: 'Hodan villa' }],
  lines: [
    {
      purchaseOrderLineId: 'l1',
      lineNumber: 1,
      description: 'Cement 50kg',
      uomCode: 'BAG',
      uomSymbol: 'bag',
      orderedQuantity: '100',
      acceptedQuantity: '40',
      remainingQuantity: '60',
    },
  ],
  canReceive: true,
  blockedReason: null,
  receiptException: null,
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  hooks.receivable.mockReturnValue(loaded([receivable()]));
});

async function pickOrder(user: UserEvent) {
  await user.click(screen.getByRole('combobox', { name: /Purchase order/ }));
  await user.type(await screen.findByPlaceholderText('Search by PO no. or supplier'), 'bakaal');
  await user.keyboard('{Enter}');
}

const table = () => within(screen.getByRole('table', { name: 'Delivered lines' }));

describe('GrnForm', () => {
  it('with no open orders shows "Nothing to receive" and a way to the orders — no form', () => {
    hooks.receivable.mockReturnValue(loaded([]));
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });

    expect(screen.getByText('Nothing to receive')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to purchase orders' })).toHaveAttribute('href', '/procurement/orders');
    expect(screen.queryByRole('button', { name: 'Post receipt' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('prefills what is still due, shows supplier · project, and the accepted value', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    expect(screen.getByText('Only open orders are listed.')).toBeInTheDocument();

    await pickOrder(user);

    expect(screen.getByText('Bakaal Steel · Hodan villa')).toBeInTheDocument();
    expect(table().getByText('Ordered 100 bag · 40 bag received before')).toBeInTheDocument();
    expect(table().getByLabelText('Delivered now')).toHaveValue('60');
    expect(screen.getByText('Accepted value $600.00 moves from ordered to received')).toBeInTheDocument();
  });

  it('notes a short delivery, and flags an over-receipt without blocking it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    const delivered = table().getByLabelText('Delivered now');
    await user.clear(delivered);
    await user.type(delivered, '50');
    expect(table().getByText('10 bag stays open on the order')).toBeInTheDocument();

    await user.clear(delivered);
    await user.type(delivered, '62');
    expect(table().getByText(/2 bag more than still due/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Post receipt' }));
    const dialog = await screen.findByRole('dialog', { name: 'Post this receipt?' });
    expect(within(dialog).getByText(/Some lines are more than still due/)).toBeInTheDocument();
  });

  /**
   * The server flags a receipt beyond its over-receipt tolerance and still posts it; it never
   * holds one. Whatever the size of the overage the note must not promise a hold.
   */
  it('words a large over-receipt neutrally — flagged, never held', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    const delivered = table().getByLabelText('Delivered now');
    await user.clear(delivered);
    await user.type(delivered, '200');
    expect(table().getByText(/140 bag more than still due/)).toBeInTheDocument();
    expect(table().getByText(/flagged as an over-receipt/)).toBeInTheDocument();
    expect(screen.queryByText(/held for review/)).not.toBeInTheDocument();
  });

  it('reports a problem inline and validates it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    await user.click(table().getByRole('button', { name: 'Report a problem' }));
    await user.type(table().getByLabelText('Rejected quantity'), '70');
    await user.click(screen.getByRole('button', { name: 'Post receipt' }));

    expect(screen.getAllByText("Rejected can't be more than delivered.").length).toBeGreaterThan(0);
    expect(screen.getAllByText('Say why it was rejected.').length).toBeGreaterThan(0);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirms, then creates and posts the receipt with derived quantities', async () => {
    const user = userEvent.setup();
    hooks.create.mockResolvedValue({ id: 'grn-1', status: 'DRAFT' });
    hooks.post.mockResolvedValue({ id: 'grn-1', status: 'POSTED' });
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    await user.click(table().getByRole('button', { name: 'Report a problem' }));
    await user.type(table().getByLabelText('Rejected quantity'), '5');
    await user.type(table().getByLabelText(/Reason/), 'Torn bags');
    await user.click(screen.getByRole('button', { name: 'Post receipt' }));

    const dialog = await screen.findByRole('dialog', { name: 'Post this receipt?' });
    expect(within(dialog).getByText("Posted receipts can't be edited.")).toBeInTheDocument();
    expect(within(dialog).queryByText(/more than still due/)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Post receipt' }));

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/procurement/grn/grn-1'));
    expect(hooks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        purchaseOrderId: 'po1',
        lines: [
          {
            purchaseOrderLineId: 'l1',
            receivedQuantity: 60,
            acceptedQuantity: 55,
            rejectedQuantity: 5,
            rejectionReason: 'Torn bags',
            qualityStatus: 'PARTIALLY_ACCEPTED',
          },
        ],
      }),
    );
    expect(hooks.post).toHaveBeenCalledWith({ id: 'grn-1' });
  });

  it('routes a held over-receipt to its detail without posting', async () => {
    const user = userEvent.setup();
    hooks.create.mockResolvedValue({ id: 'grn-2', status: 'EXCEPTION_PENDING' });
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    await user.click(screen.getByRole('button', { name: 'Post receipt' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Post receipt' }));

    await waitFor(() => expect(routerMocks.push).toHaveBeenCalledWith('/procurement/grn/grn-2'));
    expect(hooks.post).not.toHaveBeenCalled();
  });

  it("explains the server's SoD verdict, hides the lines and the primary, and offers an exception", async () => {
    const user = userEvent.setup();
    hooks.receivable.mockReturnValue(
      loaded([receivable({ canReceive: false, blockedReason: 'PO_CREATOR_CANNOT_RECEIVE_GOODS' })]),
    );
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    expect(screen.getByText('You raised this order, so someone else must receive it.')).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'Delivered lines' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post receipt' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Request an exception…' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request a receipt exception' });
    await user.type(within(dialog).getByRole('textbox'), 'Only one on site this week');
    await user.click(within(dialog).getByRole('button', { name: 'Request exception' }));
    expect(hooks.requestException).toHaveBeenCalledWith(
      { purchaseOrderId: 'po1', reason: 'Only one on site this week' },
      expect.anything(),
    );
  });

  it('turns a PO_CREATOR_CANNOT_RECEIVE_GOODS refusal on the receipt into the same notice', async () => {
    const user = userEvent.setup();
    hooks.create.mockRejectedValue(
      new ApiError(403, 'Forbidden', 'FORBIDDEN', [], { code: 'PO_CREATOR_CANNOT_RECEIVE_GOODS' }),
    );
    renderWithProviders(<GrnForm />, { permissions: [MONEY] });
    await pickOrder(user);

    await user.click(screen.getByRole('button', { name: 'Post receipt' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Post receipt' }));

    expect(await screen.findByText('You raised this order, so someone else must receive it.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Post receipt' })).not.toBeInTheDocument();
  });

  it('hides the accepted value from a money-blind role', async () => {
    const user = userEvent.setup();
    renderWithProviders(<GrnForm />, { permissions: ['create:goods-receipt'] });
    await pickOrder(user);
    expect(screen.queryByText(/Accepted value/)).not.toBeInTheDocument();
  });
});
