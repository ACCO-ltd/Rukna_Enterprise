import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * The legacy IPA/IPC authoring routes under `/contracts/[id]/applications/…` are retired (P3 Slice
 * C). Each is now a thin client boundary that resolves the contract far enough to learn its
 * projectId, then `router.replace`s into the matching project Commercial workspace route. These
 * pin the four destinations plus the loading and error states.
 */

const mocks = vi.hoisted(() => ({
  useContract: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('../hooks/use-contracts', () => ({ useContract: mocks.useContract }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), prefetch: vi.fn() }),
}));

import { ContractApplicationRedirect } from './contract-application-redirect';

const CONTRACT_ID = 'c-1';
const PROJECT_ID = 'p-77';
const IPA_ID = 'ipa-9';
const IPC_ID = 'ipc-3';
const BASE = `/projects/${PROJECT_ID}/commercial/applications`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useContract.mockReturnValue({
    data: { id: CONTRACT_ID, projectId: PROJECT_ID },
    isPending: false,
    isError: false,
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ContractApplicationRedirect', () => {
  it('redirects a new-application link to the workspace new-application route', async () => {
    renderWithProviders(
      <ContractApplicationRedirect contractId={CONTRACT_ID} target="application-new" />,
    );

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(`${BASE}/new`);
    });
  });

  it('redirects an application-detail link, preserving the ipaId', async () => {
    renderWithProviders(
      <ContractApplicationRedirect
        contractId={CONTRACT_ID}
        target="application-detail"
        ipaId={IPA_ID}
      />,
    );

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(`${BASE}/${IPA_ID}`);
    });
  });

  it('redirects a new-certificate link, preserving the ipaId', async () => {
    renderWithProviders(
      <ContractApplicationRedirect
        contractId={CONTRACT_ID}
        target="certificate-new"
        ipaId={IPA_ID}
      />,
    );

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(`${BASE}/${IPA_ID}/certificates/new`);
    });
  });

  it('redirects a certificate-detail link, preserving the ipaId and ipcId', async () => {
    renderWithProviders(
      <ContractApplicationRedirect
        contractId={CONTRACT_ID}
        target="certificate-detail"
        ipaId={IPA_ID}
        ipcId={IPC_ID}
      />,
    );

    await waitFor(() => {
      expect(mocks.replace).toHaveBeenCalledWith(
        `${BASE}/${IPA_ID}/certificates/${IPC_ID}`,
      );
    });
  });

  it('shows a loading status and does not redirect while the contract is in flight', () => {
    mocks.useContract.mockReturnValue({ data: undefined, isPending: true, isError: false });

    renderWithProviders(
      <ContractApplicationRedirect contractId={CONTRACT_ID} target="application-new" />,
    );

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('shows a graceful not-found and does not redirect on error', () => {
    mocks.useContract.mockReturnValue({ data: undefined, isPending: false, isError: true });

    renderWithProviders(
      <ContractApplicationRedirect contractId={CONTRACT_ID} target="application-new" />,
    );

    expect(screen.getByText('This contract no longer exists.')).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
