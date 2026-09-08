import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * `/contracts/[id]` is retired as a detail page (P3 Q-C). It is now a thin client boundary
 * that resolves the contract just far enough to learn its projectId, then `router.replace`s
 * into the project Commercial workspace. These pin the three states that matter:
 *
 *  - loading: a calm status region while the contract is in flight
 *  - loaded:  redirect (via replace, not push) to the workspace
 *  - error:   a graceful not-found instead of a blank screen
 */

const mocks = vi.hoisted(() => ({
  useContract: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('../hooks/use-contracts', () => ({ useContract: mocks.useContract }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import { ContractRedirect } from './contract-redirect';

const CONTRACT_ID = 'c-1';
const PROJECT_ID = 'p-77';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractRedirect', () => {
  it('redirects into the project Commercial workspace once the contract loads', async () => {
    mocks.useContract.mockReturnValue({
      data: { id: CONTRACT_ID, projectId: PROJECT_ID },
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ContractRedirect contractId={CONTRACT_ID} />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/commercial/contract-security`,
      );
    });
  });

  it('shows a loading status and does not redirect while the contract is in flight', () => {
    mocks.useContract.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderWithProviders(<ContractRedirect contractId={CONTRACT_ID} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('shows a graceful not-found and does not redirect on error', () => {
    mocks.useContract.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderWithProviders(<ContractRedirect contractId={CONTRACT_ID} />);

    expect(screen.getByText('This contract no longer exists.')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
