import { IpcStatus } from '@erp/types';
import { screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { listIpcs } from '@/features/ipc/api/ipc-api';
import type { Ipc } from '@/features/ipc/types';

import { IpcCertificatesPanel } from './ipc-certificates-panel';

vi.mock('@/features/ipc/api/ipc-api', () => ({
  listIpcs: vi.fn(),
  getIpc: vi.fn(),
  getCertificatePaymentStatus: vi.fn(),
}));

vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

function certificate(overrides: Partial<Ipc> & { id: string }): Ipc {
  return {
    applicationId: 'ipa-1',
    organizationId: 'org-1',
    certificateNumber: 1,
    certificateRef: 'IPC-001',
    status: IpcStatus.CERTIFIED,
    isEffective: true,
    effectiveAt: '2026-06-01T00:00:00.000Z',
    supersededAt: null,
    supersededById: null,
    supersessionReason: null,
    certifiedTotal: '50000.00',
    currency: 'USD',
    exchangeRateCurrency: null,
    exchangeRateBase: null,
    exchangeRateValue: null,
    exchangeRateDate: null,
    issuedAt: '2026-06-01T00:00:00.000Z',
    issuedBy: 'user-1',
    notes: null,
    createdBy: 'user-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(listIpcs).mockReset();
});

function renderPanel() {
  return renderWithProviders(
    <IpcCertificatesPanel contractId="con-1" ipaId="ipa-1" currency="USD" />,
  );
}

describe('IpcCertificatesPanel', () => {
  it('asks only for the certificates of this application', async () => {
    vi.mocked(listIpcs).mockResolvedValue([]);

    renderPanel();

    await waitFor(() => {
      expect(listIpcs).toHaveBeenCalledWith('ipa-1');
    });
  });

  describe('when the application has no certificates', () => {
    /**
     * The point of the whole panel. "Not yet certified" on its own implies a certificate
     * could arrive; nothing in this application can create one while issuance is gated on
     * C1 (#12), so the empty state has to say that rather than let someone wait.
     */
    it('says issuance is unavailable rather than implying one may arrive', async () => {
      vi.mocked(listIpcs).mockResolvedValue([]);

      renderPanel();

      expect(await screen.findByText('Not yet certified')).toBeInTheDocument();
      expect(
        screen.getByText(
          'Issuing a certificate is not yet available in Rukna, so none can be raised against this application here.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('Certificates issued against this application will appear here.'),
      ).not.toBeInTheDocument();
    });
  });

  describe('when certificates exist', () => {
    it('links each certificate to its own page beneath the application', async () => {
      vi.mocked(listIpcs).mockResolvedValue([certificate({ id: 'ipc-1' })]);

      renderPanel();

      const link = await screen.findByRole('link', { name: /IPC-001/ });
      expect(link).toHaveAttribute(
        'href',
        '/contracts/con-1/applications/ipa-1/certificates/ipc-1',
      );
    });

    it('falls back to the certificate number when it has no reference', async () => {
      vi.mocked(listIpcs).mockResolvedValue([
        certificate({ id: 'ipc-1', certificateRef: null, certificateNumber: 7 }),
      ]);

      renderPanel();

      expect(await screen.findByText('#7')).toBeInTheDocument();
    });

    it('labels the amount as gross, since the net is not shown here', async () => {
      vi.mocked(listIpcs).mockResolvedValue([certificate({ id: 'ipc-1' })]);

      renderPanel();

      expect(await screen.findByText('$50,000.00')).toBeInTheDocument();
      expect(screen.getByText('Gross certified')).toBeInTheDocument();
    });

    it('marks a superseded certificate so it is not mistaken for the live one', async () => {
      vi.mocked(listIpcs).mockResolvedValue([
        certificate({ id: 'ipc-1', isEffective: false, supersededAt: '2026-07-01T00:00:00.000Z' }),
      ]);

      renderPanel();

      expect(await screen.findByText('Superseded')).toBeInTheDocument();
      expect(screen.queryByText('Effective')).not.toBeInTheDocument();
    });

    it('shows a certificate that was raised but never issued', async () => {
      vi.mocked(listIpcs).mockResolvedValue([certificate({ id: 'ipc-1', issuedAt: null })]);

      renderPanel();

      expect(await screen.findByText('Not yet issued')).toBeInTheDocument();
    });
  });

  it('reports a load failure without taking down the application page', async () => {
    vi.mocked(listIpcs).mockRejectedValue(new Error('network'));

    renderPanel();

    expect(
      await screen.findByText('Could not load certificates for this application.'),
    ).toBeInTheDocument();
  });
});
