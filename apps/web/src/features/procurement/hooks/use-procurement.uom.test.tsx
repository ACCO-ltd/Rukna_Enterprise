import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createUom, deactivateUom } from '../api/procurement-api';
import { useCreateUom, useDeactivateUom } from './use-procurement';

vi.mock('../api/procurement-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/procurement-api')>()),
  createUom: vi.fn(),
  deactivateUom: vi.fn(),
}));

let client: QueryClient;
function wrapper({ children }: { children: React.ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  vi.mocked(createUom).mockResolvedValue({ id: 'u1', code: 'M3', name: 'Cubic metre', symbol: 'm³', status: 'ACTIVE' } as never);
  vi.mocked(deactivateUom).mockResolvedValue({} as never);
});

describe('UoM admin mutations', () => {
  it('creating a unit refreshes the open units-of-measure lookup too', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useCreateUom(), { wrapper });
    await act(() => result.current.mutateAsync({ code: 'M3', name: 'Cubic metre', symbol: 'm³' }));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['units-of-measure'] });
  });

  it('deactivating a unit refreshes the open units-of-measure lookup too', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(() => useDeactivateUom(), { wrapper });
    await act(() => result.current.mutateAsync('u1'));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['units-of-measure'] });
  });
});
