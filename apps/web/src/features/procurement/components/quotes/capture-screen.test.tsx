import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/features/auth/session/session-store';
import { renderWithProviders } from '@/test/render';

import { setUploadQueueForTests } from '../../quotations/capture/queue-instance';
import { MemoryQueueStore, UploadQueue, type QueueDeps } from '../../quotations/capture/upload-queue';
import { detailFixture, quoteFixture } from '../../quotations/test-fixtures';
import type { QuotationRequestDetail } from '../../quotations/types';

/**
 * The buyer's capture screen (spec Q11): counter, reason chips only when short, send blocked
 * with a reason while anything is uploading, per-photo upload state with tap-to-retry, the
 * frozen waiting view after send, and finance's note on a returned request.
 */

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/procurement/quotes/qr1',
  useSearchParams: () => new URLSearchParams(),
}));

const api = vi.hoisted(() => ({
  detail: null as unknown,
  getQuotationRequest: vi.fn(),
  sendQuotationRequest: vi.fn(),
  addQuote: vi.fn(),
  withdrawQuote: vi.fn(),
  reopenQuotationRequest: vi.fn(),
}));
vi.mock('../../api/quotations-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getQuotationRequest: (...args: unknown[]) => api.getQuotationRequest(...args),
  sendQuotationRequest: (...args: unknown[]) => api.sendQuotationRequest(...args),
  withdrawQuote: (...args: unknown[]) => api.withdrawQuote(...args),
  reopenQuotationRequest: (...args: unknown[]) => api.reopenQuotationRequest(...args),
}));
vi.mock('../../api/procurement-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  listSupplierDirectory: async () => [
    { id: 's1', code: 'SUP-1', name: 'Xamar Steel', status: 'ACTIVE' },
  ],
}));
vi.mock('@/features/files/api/files-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getFileDownloadUrl: async (id: string) => ({ url: `https://files.test/${id}`, originalName: id, mimeType: 'image/jpeg' }),
}));

import { QuoteCaptureScreen } from './capture-screen';

const COLLECTOR = ['view:procurement', 'collect:quotation', 'create:purchase-order'];

let uploadImpl: QueueDeps['upload'];
let addQuoteImpl: QueueDeps['addQuote'];
let queue: UploadQueue;

function makeQueue() {
  let n = 0;
  queue = new UploadQueue({
    store: new MemoryQueueStore(),
    upload: (...args) => uploadImpl(...args),
    addQuote: (...args) => addQuoteImpl(...args),
    addPhoto: async () => api.detail as QuotationRequestDetail,
    owner: () => {
      const user = sessionStore.getState().user;
      return user ? `${user.orgId}:${user.id}` : null;
    },
    isOnline: () => true,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    uuid: () => `ref-${++n}`,
  });
  setUploadQueueForTests(queue);
  void queue.start();
}

function render(detail: QuotationRequestDetail) {
  api.detail = detail;
  api.getQuotationRequest.mockImplementation(async () => api.detail);
  return renderWithProviders(<QuoteCaptureScreen id="qr1" />, { permissions: COLLECTOR });
}

const photoFile = () => new File([new Uint8Array(10)], 'IMG_1.jpg', { type: 'image/jpeg', lastModified: Date.now() });

beforeEach(() => {
  vi.clearAllMocks();
  uploadImpl = async () => 'file-new';
  addQuoteImpl = async (_id, payload) =>
    detailFixture({
      quotes: [quoteFixture({ id: 'k-new', name: payload.storeName ?? 'Xamar Steel' })],
      distinctSupplierCount: 1,
    });
  makeQueue();
});

afterEach(() => {
  setUploadQueueForTests(null);
});

describe('QuoteCaptureScreen — collecting', () => {
  it('counts stores and asks for a reason chip only when short; send needs it', async () => {
    const user = userEvent.setup();
    api.sendQuotationRequest.mockResolvedValue(detailFixture({ status: 'AWAITING_DECISION' }));
    render(detailFixture({ quotes: [quoteFixture({ id: 'k1', name: 'Hodan Hardware' })], distinctSupplierCount: 1 }));

    expect(await screen.findByText('1 of 3 stores')).toBeInTheDocument();
    const send = screen.getByRole('button', { name: 'Send to finance' });
    expect(send).toBeDisabled();
    expect(screen.getByText('Pick why there are fewer stores')).toBeInTheDocument();

    const chips = screen.getByRole('radiogroup', { name: 'Only 1 store. Why?' });
    await user.click(within(chips).getByRole('radio', { name: 'Urgent' }));
    expect(send).toBeEnabled();
    await user.click(send);
    await waitFor(() => expect(api.sendQuotationRequest).toHaveBeenCalledWith('qr1', 'URGENT'));
  });

  it('shows no reason chips once there are enough stores, and sends without a reason', async () => {
    const user = userEvent.setup();
    api.sendQuotationRequest.mockResolvedValue(detailFixture({ status: 'AWAITING_DECISION' }));
    render(
      detailFixture({
        quotes: [quoteFixture({ id: 'k1' }), quoteFixture({ id: 'k2' }), quoteFixture({ id: 'k3' })],
        distinctSupplierCount: 3,
      }),
    );
    expect(await screen.findByText('3 of 3 stores')).toBeInTheDocument();
    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Send to finance' }));
    await waitFor(() => expect(api.sendQuotationRequest).toHaveBeenCalledWith('qr1', undefined));
  });

  it('never shows a price field', async () => {
    render(detailFixture({ quotes: [quoteFixture({ id: 'k1' })], distinctSupplierCount: 1 }));
    await screen.findByText('1 of 3 stores');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/total/i)).not.toBeInTheDocument();
  });

  it('labels the capture controls and keeps the file inputs out of the tab order', async () => {
    render(detailFixture());
    expect(await screen.findByRole('button', { name: 'Snap quote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'or choose from gallery' })).toBeInTheDocument();
    const camera = screen.getByTestId('quote-camera-input');
    expect(camera).toHaveAttribute('capture', 'environment');
    expect(camera).toHaveAttribute('accept', 'image/*');
    expect(camera).toHaveAttribute('tabindex', '-1');
  });

  it('snap → store sheet → tap a new store binds the quote; send waits while it uploads', async () => {
    const user = userEvent.setup();
    let release: (id: string) => void = () => undefined;
    uploadImpl = () => new Promise((resolve) => (release = resolve));
    addQuoteImpl = vi.fn(async (_id, payload) =>
      detailFixture({ quotes: [quoteFixture({ id: 'k-new', name: payload.storeName })], distinctSupplierCount: 1 }),
    );
    render(detailFixture());
    await screen.findByRole('button', { name: 'Snap quote' });

    fireEvent.change(screen.getByTestId('quote-camera-input'), { target: { files: [photoFile()] } });

    const sheet = await screen.findByRole('dialog', { name: 'Which store?' });
    // Still uploading underneath (behind the modal): send is blocked, with the reason in words.
    expect(screen.getByText('Send to finance').closest('button')).toBeDisabled();
    expect(screen.getByText('1 photo still uploading')).toBeInTheDocument();

    await user.type(within(sheet).getByLabelText('Store name'), 'Bakaara Market');
    await user.click(within(sheet).getByRole('button', { name: 'New store: Bakaara Market' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await act(async () => release('file-new'));
    await waitFor(() =>
      expect(addQuoteImpl).toHaveBeenCalledWith('qr1', {
        clientRef: 'ref-1',
        storeName: 'Bakaara Market',
        photos: [expect.objectContaining({ platformFileId: 'file-new', source: 'CAMERA' })],
      }),
    );
    expect(await screen.findByText('Bakaara Market')).toBeInTheDocument();
  });

  it('picks a registered supplier with one tap', async () => {
    const user = userEvent.setup();
    addQuoteImpl = vi.fn(async () => detailFixture({ quotes: [quoteFixture({ id: 'k', name: 'Xamar Steel' })] }));
    render(detailFixture());
    await screen.findByRole('button', { name: 'Snap quote' });
    fireEvent.change(screen.getByTestId('quote-camera-input'), { target: { files: [photoFile()] } });
    const sheet = await screen.findByRole('dialog', { name: 'Which store?' });
    await user.click(await within(sheet).findByRole('button', { name: 'Xamar Steel' }));
    await waitFor(() =>
      expect(addQuoteImpl).toHaveBeenCalledWith('qr1', expect.objectContaining({ supplierId: 's1' })),
    );
  });

  it('shows a failed upload as tap-to-retry, which uploads again', async () => {
    const user = userEvent.setup();
    let attempts = 0;
    uploadImpl = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('no secure context'); // a non-retryable device fault
      return 'file-ok';
    });
    render(detailFixture());
    await screen.findByRole('button', { name: 'Snap quote' });
    fireEvent.change(screen.getByTestId('quote-camera-input'), { target: { files: [photoFile()] } });
    const sheet = await screen.findByRole('dialog', { name: 'Which store?' });
    await user.click(within(sheet).getByRole('button', { name: 'Choose later' }));

    const retry = await screen.findByRole('button', { name: 'Retry upload of Choose store' });
    expect(retry).toHaveTextContent('Failed — tap to retry');
    expect(screen.getByText('1 photo failed — retry or discard')).toBeInTheDocument();
    await user.click(retry);
    await waitFor(() => expect(uploadImpl).toHaveBeenCalledTimes(2));
  });
});

describe('QuoteCaptureScreen — after send', () => {
  it('freezes the photos, shows the waiting time and offers reopen behind a confirm', async () => {
    const user = userEvent.setup();
    render(
      detailFixture({
        status: 'AWAITING_DECISION',
        sentAt: '2026-10-07T07:42:00.000Z',
        waitingWorkingMinutes: 37,
        quotes: [quoteFixture({ id: 'k1', name: 'Hodan' })],
        allowedActions: [{ action: 'REOPEN', enabled: true }],
      }),
    );
    expect(await screen.findByText('Waiting for finance', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByText(/waiting 37 m/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Snap quote' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send to finance' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Reopen to change a photo' }));
    expect(await screen.findByRole('dialog', { name: 'Reopen QR-00041?' })).toBeInTheDocument();
  });

  it("shows finance's note on a returned request, above the camera", async () => {
    render(
      detailFixture({
        status: 'RETURNED',
        returnNote: 'Check Xamar Steel too',
        quotes: [quoteFixture({ id: 'k1' })],
        distinctSupplierCount: 1,
      }),
    );
    expect(await screen.findByText('Finance asked for another quote')).toBeInTheDocument();
    expect(screen.getByText('“Check Xamar Steel too”')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Snap quote' })).toBeInTheDocument();
  });
});
