import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError } from '@/lib/api-client';
import { renderWithProviders } from '@/test/render';

import { detailFixture, quoteFixture } from '../../quotations/test-fixtures';
import type { OrderDraft, QuotationRequestDetail } from '../../quotations/types';

/**
 * Raise the order (spec Q13): one confirm in the common case, prefilled from the award; MANUAL
 * split goes to the line editor; the editor caps the total at the award and disables create over
 * it; a server PO_EXCEEDS_AWARD offers "Send back to finance".
 */

const nav = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => nav,
  usePathname: () => '/procurement/quotes/qr1',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));
const api = vi.hoisted(() => ({
  detail: null as unknown,
  draft: null as unknown,
  raise: vi.fn(),
  redecide: vi.fn(),
}));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuotationRequest: async () => api.detail,
  getOrderDraft: async () => api.draft,
  raiseOrder: (...args: unknown[]) => api.raise(...args),
  requestRedecision: (...args: unknown[]) => api.redecide(...args),
}));

import { OrderAdjustScreen } from './order-adjust-screen';
import { OrderCard } from './order-raise';

const BUYER = ['view:procurement', 'collect:quotation', 'create:purchase-order'];

const awarded = (patch: Partial<QuotationRequestDetail> = {}): QuotationRequestDetail =>
  detailFixture({
    status: 'AWARDED',
    quotes: [quoteFixture({ id: 'k3', name: 'Xamar Steel', enteredTotal: '2295.00' })],
    award: {
      quoteId: 'k3',
      total: '2295.00',
      supplier: { id: 's9', name: 'Xamar Steel', code: 'QS-00001' },
      paymentPath: 'FINANCE_PAYS_SUPPLIER',
    },
    allowedActions: [{ action: 'RAISE_ORDER', enabled: true, reasonCode: null }],
    ...patch,
  });

const orderDraft = (patch: Partial<OrderDraft> = {}): OrderDraft => ({
  supplier: { id: 's9', name: 'Xamar Steel' },
  awardedTotal: '2295.00',
  splitMode: 'ESTIMATE',
  lines: [
    { materialRequestLineId: 'l1', description: 'Cement 42.5', quantity: '50.0000', maxQuantity: '50.0000', uom: 'bag', amount: '1147.50' },
    { materialRequestLineId: 'l2', description: 'Rebar 12mm', quantity: '40.0000', maxQuantity: '40.0000', uom: 'pc', amount: '1147.50' },
  ],
  ...patch,
});

const unpriced = () => orderDraft({ splitMode: 'MANUAL', lines: orderDraft().lines.map((l) => ({ ...l, amount: null })) });

beforeEach(() => {
  vi.clearAllMocks();
  api.detail = awarded();
  api.draft = orderDraft();
  api.raise.mockResolvedValue({ purchaseOrderId: 'po7' });
});

describe('OrderCard — raise the order', () => {
  it('raises the prefilled draft in one confirm and opens it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderCard detail={awarded()} />, { permissions: BUYER, withToast: true });
    expect(screen.getByText('Chosen: Xamar Steel')).toBeInTheDocument();
    expect(screen.getByText('Pay by: Finance pays supplier')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Raise the order' }));
    const dialog = await screen.findByRole('dialog', { name: 'Raise the order' });
    expect(await within(dialog).findByText('Cement 42.5')).toBeInTheDocument();
    expect(within(dialog).getByText('of $2,295.00 chosen')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Create draft order' }));
    await waitFor(() => expect(api.raise).toHaveBeenCalledWith('qr1', {}));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/procurement/orders/po7'));
  });

  it('goes straight to the line editor when the split must be typed (MANUAL)', async () => {
    const user = userEvent.setup();
    api.draft = unpriced();
    const { rerender } = renderWithProviders(<OrderCard detail={awarded()} />, { permissions: BUYER });
    // Let the prefetched draft land before the tap.
    await new Promise((resolve) => setTimeout(resolve, 20));
    rerender(<OrderCard detail={awarded()} />);
    await user.click(screen.getByRole('button', { name: 'Raise the order' }));
    expect(nav.push).toHaveBeenCalledWith('/procurement/quotes/qr1/order');
  });

  it('links to the raised order instead of raising twice', () => {
    renderWithProviders(
      <OrderCard detail={awarded({ purchaseOrder: { id: 'po7', poNumber: 'PO-00007', status: 'DRAFT' } })} />,
      { permissions: BUYER },
    );
    expect(screen.getByRole('link', { name: /Open order · PO-00007/ })).toHaveAttribute('href', '/procurement/orders/po7');
    expect(screen.queryByRole('button', { name: 'Raise the order' })).not.toBeInTheDocument();
  });

  it('offers send-back-to-finance when the server says the order exceeds the award', async () => {
    const user = userEvent.setup();
    api.raise.mockRejectedValue(new ApiError(422, 'Exceeds', 'UNPROCESSABLE', [], { code: 'PO_EXCEEDS_AWARD' }));
    renderWithProviders(<OrderCard detail={awarded()} />, { permissions: BUYER, withToast: true });
    await user.click(screen.getByRole('button', { name: 'Raise the order' }));
    const dialog = await screen.findByRole('dialog', { name: 'Raise the order' });
    await within(dialog).findByText('Cement 42.5');
    await user.click(within(dialog).getByRole('button', { name: 'Create draft order' }));
    expect(await within(dialog).findByText('The order is more than the chosen quote')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Send back to finance' })).toBeInTheDocument();
  });
});

describe('OrderAdjustScreen', () => {
  it('prefills the split, shows the meter, and disables create over the award', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderAdjustScreen id="qr1" />, { permissions: BUYER, withToast: true });
    const cement = await screen.findByLabelText('Amount for Cement 42.5');
    expect(cement).toHaveValue('1,147.50');
    expect(screen.getAllByText('$2,295.00 of $2,295.00').length).toBeGreaterThan(0);
    const create = screen.getByRole('button', { name: 'Create draft order' });
    expect(create).toBeEnabled();

    await user.clear(cement);
    await user.type(cement, '1200');
    expect(screen.getByText('Over the chosen total by $52.50')).toBeInTheDocument();
    expect(create).toBeDisabled();

    await user.clear(cement);
    await user.type(cement, '1000');
    await user.click(screen.getByRole('switch', { name: 'Include: Rebar 12mm' }));
    expect(create).toBeEnabled();
    await user.click(create);
    await waitFor(() =>
      expect(api.raise).toHaveBeenCalledWith('qr1', {
        lines: [{ materialRequestLineId: 'l1', quantity: '50', amount: '1000' }],
      }),
    );
  });

  it('asks for amounts in MANUAL mode', async () => {
    api.draft = unpriced();
    renderWithProviders(<OrderAdjustScreen id="qr1" />, { permissions: BUYER });
    expect(
      await screen.findByText("The request's lines are not priced, so split the chosen total across them."),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft order' })).toBeDisabled();
  });

  it('refuses a quantity above what the request needs', async () => {
    const user = userEvent.setup();
    renderWithProviders(<OrderAdjustScreen id="qr1" />, { permissions: BUYER });
    const qty = await screen.findByLabelText('Quantity for Rebar 12mm');
    await user.clear(qty);
    await user.type(qty, '41');
    expect(screen.getByText('More than requested')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create draft order' })).toBeDisabled();
  });
});
