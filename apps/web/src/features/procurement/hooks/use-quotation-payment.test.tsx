import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionStore } from '@/features/auth/session/session-store';
import { ApiError } from '@/lib/api-client';

import { paymentFixture } from '../quotations/payment-fixtures';
import type { ReleaseCashPayload } from '../quotations/payment-types';
import type { QuotationRequestDetail } from '../quotations/types';
import { detailFixture } from '../quotations/test-fixtures';

const api = vi.hoisted(() => ({ release: vi.fn(), pay: vi.fn() }));
vi.mock('../api/quotation-payment-api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  releaseCash: (...args: unknown[]) => api.release(...args),
  payFromAward: (...args: unknown[]) => api.pay(...args),
}));

import {
  pendingPaymentStore,
  useCanPay,
  useIdempotencyKey,
  usePayFromAward,
  useReleaseCash,
} from './use-quotation-payment';
import { quotationKeys } from './use-quotations';

function wrapper(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

const body: ReleaseCashPayload = {
  idempotencyKey: 'k1',
  quotationRequestId: 'qr1',
  recipientUserId: 'u-ahmed',
  amount: '1000.00',
  bankAccountId: 'ba-cash',
  paymentMethod: 'CASH',
  advancedAt: '2026-10-08',
};

beforeEach(() => {
  api.release.mockReset();
  api.pay.mockReset();
  localStorage.clear();
});
afterEach(() => {
  sessionStore.clearSession();
});

describe('useIdempotencyKey', () => {
  it('keeps one key while the dialog stays open (retries reuse it) and makes a new one on reopen', () => {
    const { result, rerender } = renderHook(({ open }) => useIdempotencyKey(open), { initialProps: { open: true } });
    const first = result.current;
    rerender({ open: true });
    rerender({ open: true });
    expect(result.current).toBe(first);

    rerender({ open: false });
    expect(result.current).toBe(first);
    rerender({ open: true });
    expect(result.current).not.toBe(first);
    expect(result.current).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('useReleaseCash', () => {
  it('writes the returned payment read model into the request detail', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(quotationKeys.detail('qr1'), detailFixture({ status: 'AWARDED' }));
    const payment = paymentFixture({ state: 'CASH_WITH_BUYER', withBuyer: '1000.00' });
    api.release.mockResolvedValue({ advance: { id: 'adv1' }, payment });

    const { result } = renderHook(() => useReleaseCash('qr1'), { wrapper: wrapper(qc) });
    await act(() => result.current.mutateAsync(body));

    expect(api.release).toHaveBeenCalledWith(body);
    const detail = qc.getQueryData<QuotationRequestDetail>(quotationKeys.detail('qr1'));
    expect(detail?.payment?.state).toBe('CASH_WITH_BUYER');
  });

  it('keeps the exact body when the approval gate answers 409, for the re-drive', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.release.mockRejectedValue(new ApiError(409, 'Approval required', 'CONFLICT', [], { approvalInstanceId: 'wf9' }));

    const { result } = renderHook(() => useReleaseCash('qr1'), { wrapper: wrapper(qc) });
    act(() => result.current.mutate(body));
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(pendingPaymentStore.get('qr1')).toEqual({ kind: 'release', body });
  });

  it('does not keep a body for an ordinary refusal', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    api.release.mockRejectedValue(new ApiError(409, 'Too much', 'CONFLICT', [], { code: 'FUNDING_EXCEEDS_ORDER' }));
    const { result } = renderHook(() => useReleaseCash('qr1'), { wrapper: wrapper(qc) });
    act(() => result.current.mutate(body));
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(pendingPaymentStore.get('qr1')).toBeNull();
  });
});

describe('usePayFromAward', () => {
  it('keeps the body while the payment awaits signatures and clears it once posted', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const payBody = {
      idempotencyKey: 'k2',
      quotationRequestId: 'qr1',
      bankAccountId: 'ba-salaam',
      paymentMethod: 'BANK' as const,
      paymentDate: '2026-10-08',
      amount: '1000.00',
      shape: 'PREPAY' as const,
    };
    api.pay.mockResolvedValueOnce({ payment: { id: 'sp1' }, awaiting: 'RELEASE_SIGNATURES' });
    const { result } = renderHook(() => usePayFromAward('qr1'), { wrapper: wrapper(qc) });
    await act(() => result.current.mutateAsync(payBody));
    expect(pendingPaymentStore.get('qr1')).toEqual({ kind: 'pay', body: payBody });

    api.pay.mockResolvedValueOnce({ payment: { id: 'sp1' } });
    await act(() => result.current.mutateAsync(payBody));
    expect(pendingPaymentStore.get('qr1')).toBeNull();
  });
});

describe('useCanPay', () => {
  function signIn(permissions: string[]) {
    sessionStore.setSession({
      accessToken: 't',
      user: { id: 'u1', email: 'a@b.c', name: null, orgId: 'o1', tenantSlug: 't', roles: [], permissions },
    } as never);
  }
  it('is manage:payable and nothing else', () => {
    act(() => signIn(['manage:payable']));
    expect(renderHook(() => useCanPay()).result.current).toBe(true);
    act(() => signIn(['view:procurement', 'collect:quotation', 'award:quotation']));
    expect(renderHook(() => useCanPay()).result.current).toBe(false);
  });
});
