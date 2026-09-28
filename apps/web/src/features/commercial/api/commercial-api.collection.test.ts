import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api-client';

import { createCreditNote, openDispute, postCreditNote, recordFollowUp, recordPromise, resolveDispute } from './commercial-api';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn().mockResolvedValue({ id: 'x' }) }));

beforeEach(() => vi.mocked(apiClient).mockClear());

/** The collection routes live under the invoice; the body must not carry the invoice id. */
describe('collection API paths', () => {
  it.each([
    ['follow-ups', () => recordFollowUp('p1', { invoiceId: 'i1', method: 'PHONE', occurredAt: '2026-09-28T09:00:00Z' })],
    ['promises', () => recordPromise('p1', { invoiceId: 'i1', promisedDate: '2026-10-05' })],
    ['disputes', () => openDispute('p1', { invoiceId: 'i1', reason: 'OTHER' })],
    ['credit-notes', () => createCreditNote('p1', { invoiceId: 'i1', reason: 'CORRECTION', netAmount: '10.00', accountingDate: '2026-09-28' })],
  ])('posts %s under the invoice, without invoiceId in the body', async (segment, call) => {
    await call();
    const [url, init] = vi.mocked(apiClient).mock.calls[0]!;
    expect(url).toBe(`/projects/p1/commercial/invoices/i1/${segment}`);
    expect(JSON.parse(String((init as RequestInit).body))).not.toHaveProperty('invoiceId');
  });

  it('resolves a dispute and posts a credit note under the invoice too', async () => {
    await resolveDispute('p1', 'i1', 'd1');
    await postCreditNote('p1', 'i1', 'cn1');
    expect(vi.mocked(apiClient).mock.calls.map(([url]) => url)).toEqual([
      '/projects/p1/commercial/invoices/i1/disputes/d1/resolve',
      '/projects/p1/commercial/invoices/i1/credit-notes/cn1/post',
    ]);
  });
});
