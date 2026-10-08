import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/features/auth/session/session-store';
import { renderWithProviders } from '@/test/render';

import { setUploadQueueForTests } from '../../quotations/capture/queue-instance';
import { MemoryQueueStore, UploadQueue, type QueueDeps } from '../../quotations/capture/upload-queue';
import { paymentFixture } from '../../quotations/payment-fixtures';
import type { QuotationPayment } from '../../quotations/payment-types';
import { detailFixture, quoteFixture } from '../../quotations/test-fixtures';
import type { QuotationRequestDetail } from '../../quotations/types';

/**
 * The buyer's side of paying from the award (ADR-045 P12, wireframe D): four written steps, the
 * cash released to them with the amount when they may see it, one big *Photograph the receipt*,
 * pages that upload at once and a single *Send receipt* — and no amount field anywhere.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/procurement/quotes/qr1',
  useSearchParams: () => new URLSearchParams(),
}));
const api = vi.hoisted(() => ({ detail: null as unknown }));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuotationRequest: async () => api.detail,
}));
vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));

import { QuoteCaptureScreen } from './capture-screen';

const BUYER = ['view:procurement', 'collect:quotation', 'create:purchase-order', 'view:commitment-ledger'];

let online = true;
let addStoreDocument: ReturnType<typeof vi.fn>;
let queue: UploadQueue;

function makeQueue() {
  let n = 0;
  addStoreDocument = vi.fn(async () => ({ id: 'sd-1', number: 'SD-00019', status: 'SUBMITTED' }));
  queue = new UploadQueue({
    store: new MemoryQueueStore(),
    upload: async () => `file-${++n}`,
    addQuote: async () => api.detail as QuotationRequestDetail,
    addPhoto: async () => api.detail as QuotationRequestDetail,
    addStoreDocument: addStoreDocument as unknown as QueueDeps['addStoreDocument'],
    addStoreDocumentPhoto: async () => ({ id: 'sd-1' }) as never,
    owner: () => {
      const user = sessionStore.getState().user;
      return user ? `${user.orgId}:${user.id}` : null;
    },
    isOnline: () => online,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    uuid: () => `ref-${++n}`,
  });
  setUploadQueueForTests(queue);
  void queue.start();
}

function awarded(payment: Partial<QuotationPayment>): QuotationRequestDetail {
  return detailFixture({
    status: 'AWARDED',
    quotes: [quoteFixture({ id: 'k1', name: 'Bakaara Steel' })],
    award: { quoteId: 'k1', total: '1000.00', supplier: { id: 's9', name: 'Bakaara Steel' }, paymentPath: 'BUYER_CASH' },
    purchaseOrder: { id: 'po1', poNumber: 'PO-00311', status: 'OPEN' },
    payment: paymentFixture(payment),
  });
}

const cashReleased = (patch: Partial<QuotationPayment> = {}) =>
  awarded({
    state: 'CASH_WITH_BUYER',
    funded: '1000.00',
    withBuyer: '1000.00',
    advances: [
      {
        id: 'adv1',
        recipientUserId: 'test-user',
        recipientName: 'Ahmed Ali',
        amount: '1000.00',
        advancedAt: '2026-10-08',
        applied: '0.00',
        returned: '0.00',
        outstanding: '1000.00',
        legacy: false,
      },
    ],
    allowedActions: [{ action: 'PHOTOGRAPH_RECEIPT', enabled: true }],
    ...patch,
  });

const photo = () => new File([new Uint8Array(10)], 'IMG_9.jpg', { type: 'image/jpeg', lastModified: Date.now() });

beforeEach(() => {
  online = true;
  makeQueue();
});
afterEach(() => setUploadQueueForTests(null));

describe('BuyerPaymentCard', () => {
  it('says the cash is released to the buyer with the amount, what to do next, and has no amount input', async () => {
    api.detail = cashReleased();
    renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: BUYER });

    expect(await screen.findByText('Cash released to you')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Payment for this order' });
    expect(within(card).getByText('$1,000.00')).toBeInTheDocument();
    expect(screen.getByText('Pay Bakaara Steel, then photograph the receipt.')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Payment progress' });
    expect(steps.querySelector('[aria-current="step"]')).toHaveTextContent('Cash released');
    expect(screen.getByRole('button', { name: 'Photograph the receipt' })).toBeEnabled();
    expect(screen.getByText('No amount to type — finance reads it from the photo.')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  });

  it('does not show the amount when the role may not see it', async () => {
    api.detail = cashReleased({
      moneyVisible: false,
      withBuyer: null,
      advances: [
        { id: 'adv1', recipientUserId: 'test-user', recipientName: 'Ahmed Ali', amount: null, advancedAt: '2026-10-08', applied: null, returned: null, outstanding: null, legacy: false },
      ],
    });
    renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: ['view:procurement', 'collect:quotation'] });
    expect(await screen.findByText('Finance has the amount — ask them if you need it.')).toBeInTheDocument();
    const card = screen.getByRole('region', { name: 'Payment for this order' });
    expect(within(card).queryByText(/\$/)).not.toBeInTheDocument();
  });

  it('uploads the photo at once and creates the receipt on Send with the PO, RECEIPT and a clientRef', async () => {
    const user = userEvent.setup();
    api.detail = cashReleased();
    renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: BUYER });
    await screen.findByText('Cash released to you');

    fireEvent.change(screen.getByTestId('quote-camera-input'), { target: { files: [photo()] } });
    const send = await screen.findByRole('button', { name: 'Send receipt' });
    expect(await screen.findByText(/1 page ready/)).toBeInTheDocument();
    expect(addStoreDocument).not.toHaveBeenCalled();

    await user.click(send);
    await waitFor(() => expect(addStoreDocument).toHaveBeenCalledTimes(1));
    const payload = addStoreDocument.mock.calls[0]![0] as Record<string, unknown>;
    expect(payload).toMatchObject({ purchaseOrderId: 'po1', kind: 'RECEIPT' });
    expect(typeof payload.clientRef).toBe('string');
    expect(payload).not.toHaveProperty('amount');
  });

  it('keeps the receipt on the phone while offline and sends it when the signal is back', async () => {
    const user = userEvent.setup();
    api.detail = cashReleased();
    renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: BUYER });
    await screen.findByText('Cash released to you');
    fireEvent.change(screen.getByTestId('quote-camera-input'), { target: { files: [photo()] } });
    await screen.findByText(/1 page ready/);

    online = false;
    await user.click(screen.getByRole('button', { name: 'Send receipt' }));
    expect(await screen.findByText("No signal — it will send when you're back online.")).toBeInTheDocument();
    expect(addStoreDocument).not.toHaveBeenCalled();

    online = true;
    queue.pump();
    await waitFor(() => expect(addStoreDocument).toHaveBeenCalledTimes(1));
  });

  it('while finance has not released yet, says it is waiting for cash and offers no capture', async () => {
    api.detail = awarded({ state: 'READY_TO_PAY', allowedActions: [] });
    renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: BUYER });
    expect(await screen.findByText("Finance is releasing the cash. You'll get a message when it's ready.")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Photograph the receipt' })).not.toBeInTheDocument();
  });

  it('shows a sent-back receipt with the reason and the status written out', async () => {
    api.detail = cashReleased({
      storeDocuments: [
        { id: 'sd-1', number: 'SD-00019', kind: 'RECEIPT', status: 'REJECTED', uploadedByName: 'Ahmed Ali', createdAt: '2026-10-08T07:42:00Z', rejectReason: 'ILLEGIBLE' },
      ],
    });
    renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: BUYER });
    expect(await screen.findByText('Sent back')).toBeInTheDocument();
    expect(screen.getByText(/Can't read it/)).toBeInTheDocument();
    expect(screen.getByText('Photograph it again and send it.')).toBeInTheDocument();
  });
});
