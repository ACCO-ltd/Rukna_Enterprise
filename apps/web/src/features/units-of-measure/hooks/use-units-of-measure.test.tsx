import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/lib/api-client';

import { useUnitsOfMeasure } from './use-units-of-measure';

vi.mock('@/lib/api-client', () => ({ apiClient: vi.fn() }));

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => vi.mocked(apiClient).mockReset());

describe('useUnitsOfMeasure', () => {
  it('reads active units from the open lookup, not the procurement admin route', async () => {
    vi.mocked(apiClient).mockResolvedValue([{ code: 'M3', name: 'Cubic metre', symbol: 'm³' }]);
    const { result } = renderHook(() => useUnitsOfMeasure(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient).toHaveBeenCalledWith('/units-of-measure', { params: { status: 'ACTIVE' } });
    expect(result.current.data).toEqual([{ code: 'M3', name: 'Cubic metre', symbol: 'm³' }]);
  });

  it('can ask for inactive units', async () => {
    vi.mocked(apiClient).mockResolvedValue([]);
    const { result } = renderHook(() => useUnitsOfMeasure('INACTIVE'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(apiClient).toHaveBeenCalledWith('/units-of-measure', { params: { status: 'INACTIVE' } });
  });
});
