import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useCreateIpa } from './use-ipa';

/**
 * `useCreateIpa` must land a freshly created application on its detail page **inside the project
 * workspace** — `${basePath}/${created.id}` where `basePath` is
 * `/projects/:id/commercial/applications` — not on the retired `/contracts/*` route.
 */

const mocks = vi.hoisted(() => ({
  createIpa: vi.fn(),
  push: vi.fn(),
}));

vi.mock('../api/ipa-api', () => ({ createIpa: mocks.createIpa }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }) }));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const BASE_PATH = '/projects/p-1/commercial/applications';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateIpa', () => {
  it('redirects to the project-scoped application detail after creating', async () => {
    mocks.createIpa.mockResolvedValue({ id: 'ipa-42' });

    const { result } = renderHook(() => useCreateIpa('con-1', BASE_PATH), { wrapper });

    result.current.mutate({ contractId: 'con-1' });

    await waitFor(() => {
      expect(mocks.push).toHaveBeenCalledWith(`${BASE_PATH}/ipa-42`);
    });
    // Specifically: never the retired /contracts/* route.
    expect(mocks.push).not.toHaveBeenCalledWith(expect.stringContaining('/contracts/'));
  });
});
