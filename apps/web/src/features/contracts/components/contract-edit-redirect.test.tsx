import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * `/contracts/[id]/edit` is retired (P3 Slice B). It is now a thin client boundary that resolves
 * the contract far enough to learn its projectId, then `router.replace`s into the workspace edit
 * route. Mirrors the retired-detail redirect. These pin the three states.
 */

const mocks = vi.hoisted(() => ({
  useContract: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('../hooks/use-contracts', () => ({ useContract: mocks.useContract }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import { ContractEditRedirect } from './contract-edit-redirect';

const CONTRACT_ID = 'c-1';
const PROJECT_ID = 'p-77';

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractEditRedirect', () => {
  it('redirects into the workspace contract edit route once the contract loads', async () => {
    mocks.useContract.mockReturnValue({
      data: { id: CONTRACT_ID, projectId: PROJECT_ID },
      isPending: false,
      isError: false,
    });

    renderWithProviders(<ContractEditRedirect contractId={CONTRACT_ID} />);

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        `/projects/${PROJECT_ID}/commercial/contract/edit`,
      );
    });
  });

  it('shows a loading status and does not redirect while the contract is in flight', () => {
    mocks.useContract.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderWithProviders(<ContractEditRedirect contractId={CONTRACT_ID} />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('shows a graceful not-found and does not redirect on error', () => {
    mocks.useContract.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderWithProviders(<ContractEditRedirect contractId={CONTRACT_ID} />);

    expect(screen.getByText('This contract no longer exists.')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
