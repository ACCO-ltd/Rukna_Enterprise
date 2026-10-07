import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiClient = vi.fn();
vi.mock('@/lib/api-client', () => ({ apiClient: (...args: unknown[]) => apiClient(...args) }));

import {
  addQuote,
  addQuotePhoto,
  askForAnotherQuote,
  awardQuotation,
  cancelQuotationRequest,
  enterQuoteTotal,
  getOrderDraft,
  getQuotationRequest,
  listQuotationRequests,
  openQuotationRequest,
  raiseOrder,
  rejectQuote,
  reopenQuotationRequest,
  requestRedecision,
  sendQuotationRequest,
  withdrawAward,
  withdrawQuote,
} from './quotations-api';

const BASE = '/procurement/quotation-requests';

function lastCall(): { path: string; method: string; body: unknown; params?: Record<string, string> } {
  const [path, options = {}] = apiClient.mock.calls.at(-1) as [string, RequestInit & { params?: Record<string, string> }];
  return {
    path,
    method: options.method ?? 'GET',
    body: typeof options.body === 'string' ? JSON.parse(options.body) : undefined,
    params: options.params,
  };
}

describe('quotations api', () => {
  beforeEach(() => {
    apiClient.mockReset();
    apiClient.mockResolvedValue({});
  });

  it('lists a queue with its filters and returns the paged envelope', async () => {
    const page = { items: [{ id: 'a' }], page: 1, limit: 25, total: 1 };
    apiClient.mockResolvedValueOnce(page);
    await expect(listQuotationRequests({ queue: 'collect', projectId: 'p1', q: 'cem', mine: true, limit: 50 })).resolves.toBe(page);
    expect(lastCall()).toMatchObject({
      path: BASE,
      method: 'GET',
      params: { queue: 'collect', projectId: 'p1', q: 'cem', mine: 'true', limit: '50' },
    });
  });

  it.each([
    ['detail', () => getQuotationRequest('q1'), `${BASE}/q1`, 'GET', undefined],
    ['open', () => openQuotationRequest('mr1'), BASE, 'POST', { materialRequestId: 'mr1' }],
    [
      'add quote',
      () => addQuote('q1', { clientRef: 'c1', storeName: 'Hodan', photos: [] }),
      `${BASE}/q1/quotes`,
      'POST',
      { clientRef: 'c1', storeName: 'Hodan', photos: [] },
    ],
    [
      'add page',
      () => addQuotePhoto('q1', 'k1', { platformFileId: 'f1', capturedAt: 't', source: 'CAMERA' }),
      `${BASE}/q1/quotes/k1/photos`,
      'POST',
      { platformFileId: 'f1', capturedAt: 't', source: 'CAMERA' },
    ],
    ['withdraw quote', () => withdrawQuote('q1', 'k1'), `${BASE}/q1/quotes/k1/withdraw`, 'POST', undefined],
    ['send', () => sendQuotationRequest('q1'), `${BASE}/q1/send`, 'POST', {}],
    ['send short', () => sendQuotationRequest('q1', 'URGENT'), `${BASE}/q1/send`, 'POST', { exceptionReason: 'URGENT' }],
    ['reopen', () => reopenQuotationRequest('q1', 'blurred'), `${BASE}/q1/reopen`, 'POST', { reason: 'blurred' }],
    ['total', () => enterQuoteTotal('q1', 'k1', '2350.00'), `${BASE}/q1/quotes/k1/total`, 'PUT', { total: '2350.00' }],
    ['reject', () => rejectQuote('q1', 'k1', 'ILLEGIBLE'), `${BASE}/q1/quotes/k1/reject`, 'POST', { reason: 'ILLEGIBLE' }],
    ['ask another', () => askForAnotherQuote('q1', 'Try Xamar'), `${BASE}/q1/ask-another`, 'POST', { note: 'Try Xamar' }],
    [
      'award',
      () => awardQuotation('q1', { quoteId: 'k1', paymentPath: 'BUYER_CASH' }),
      `${BASE}/q1/award`,
      'POST',
      { quoteId: 'k1', paymentPath: 'BUYER_CASH' },
    ],
    ['withdraw award', () => withdrawAward('q1'), `${BASE}/q1/withdraw-award`, 'POST', undefined],
    ['redecision', () => requestRedecision('q1', 'over'), `${BASE}/q1/request-redecision`, 'POST', { reason: 'over' }],
    ['order draft', () => getOrderDraft('q1'), `${BASE}/q1/order-draft`, 'GET', undefined],
    ['raise order', () => raiseOrder('q1'), `${BASE}/q1/raise-order`, 'POST', {}],
    ['cancel', () => cancelQuotationRequest('q1', 'not needed'), `${BASE}/q1/cancel`, 'POST', { reason: 'not needed' }],
  ])('%s hits the spec path', async (_name, call, path, method, body) => {
    await call();
    expect(lastCall()).toMatchObject({ path, method, body });
  });
});
