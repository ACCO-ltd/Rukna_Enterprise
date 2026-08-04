import { BillingModel, ContractStatus, IpcStatus } from '@erp/types';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { getCertificatePaymentStatus, getIpc } from '@/features/ipc/api/ipc-api';
import { getContract } from '@/features/contracts/api/contracts-api';
import type { ContractDetail } from '@/features/contracts/types';
import type { IpcDetail as IpcDetailType } from '@/features/ipc/types';
import { ApiError } from '@/lib/api-client';

import { IpcDetail } from './ipc-detail';

vi.mock('@/features/ipc/api/ipc-api', () => ({
  listIpcs: vi.fn(),
  getIpc: vi.fn(),
  getCertificatePaymentStatus: vi.fn(),
}));

vi.mock('@/features/contracts/api/contracts-api', () => ({
  getContract: vi.fn(),
  listContracts: vi.fn(),
  createContract: vi.fn(),
  updateContract: vi.fn(),
  cancelContract: vi.fn(),
  terminateContract: vi.fn(),
  runContractCommand: vi.fn(),
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

function contract(): ContractDetail {
  return {
    id: 'con-1',
    projectId: 'proj-1',
    organizationId: 'org-1',
    clientId: 'cli-1',
    boqVersionId: 'bv-1',
    contractNumber: 'CON-001',
    contractValue: '1000000.00',
    currency: 'USD',
    billingModel: BillingModel.MEASURED_IPC,
    status: ContractStatus.ACTIVE,
    clientNameSnapshot: 'Baraka Real Estate LLC',
    clientTaxSnapshot: 'SO-123456',
    startDate: null,
    expectedEndDate: null,
    createdBy: 'user-1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    retentionTerms: null,
    advanceTerms: [],
    guarantees: [],
    milestones: [],
    attachments: [],
    client: { id: 'cli-1', name: 'Baraka Real Estate LLC', taxNumber: 'SO-123456' },
  };
}

/** Gross 50,000 less 2,500 retention = 47,500 net — the shape C7 (#11) cannot report as paid. */
function certificate(overrides: Partial<IpcDetailType> = {}): IpcDetailType {
  return {
    id: 'ipc-1',
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
    items: [],
    deductions: [],
    attachments: [],
    totalCertifiedAmount: '50000.00',
    totalDeductions: '2500.00',
    netCertified: '47500.00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getIpc).mockReset();
  vi.mocked(getContract).mockReset();
  vi.mocked(getCertificatePaymentStatus).mockReset();
  vi.mocked(getContract).mockResolvedValue(contract());
  // Every test renders the settlement section, so give it a default rather than leaving the
  // query resolving undefined in the tests that are not about payment.
  vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
    totalAllocated: 0,
    status: 'UNPAID',
  });
});

function renderDetail() {
  return renderWithProviders(<IpcDetail contractId="con-1" ipaId="ipa-1" ipcId="ipc-1" />);
}

describe('IpcDetail', () => {
  it('leads with the net certified amount, which is what the client owes', async () => {
    vi.mocked(getIpc).mockResolvedValue(certificate());
    vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
      totalAllocated: 0,
      status: 'UNPAID',
    });

    renderDetail();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('$47,500.00');
    expect(screen.getByText('Net certified')).toBeInTheDocument();
  });

  describe('settlement', () => {
    /**
     * The reason this screen derives settlement instead of displaying the API's. The
     * endpoint measures allocations against the GROSS total, so a certificate carrying
     * retention and settled in full reports PARTIALLY_PAID forever (C7, #11). Here the API
     * says exactly that and the screen must still say Paid.
     */
    it('reports a fully settled certificate as paid even when the API says otherwise', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
        totalAllocated: 47500,
        status: 'PARTIALLY_PAID',
      });

      renderDetail();

      expect(await screen.findByText('Paid')).toBeInTheDocument();
      expect(screen.queryByText('Partly paid')).not.toBeInTheDocument();
    });

    it('shows what has been allocated and what is still outstanding', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
        totalAllocated: 20000,
        status: 'PARTIALLY_PAID',
      });

      renderDetail();

      expect(await screen.findByText('Partly paid')).toBeInTheDocument();
      expect(screen.getByText('$20,000.00')).toBeInTheDocument();
      expect(screen.getByText('$27,500.00')).toBeInTheDocument();
    });

    it('flags a certificate with more allocated against it than it is worth', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
        totalAllocated: 48000,
        status: 'PAID',
      });

      renderDetail();

      expect(await screen.findByText('Over-allocated')).toBeInTheDocument();
      expect(
        screen.getByText('More has been allocated to this certificate than it is worth.'),
      ).toBeInTheDocument();
    });

    it('keeps the certificate readable when the allocation total cannot be loaded', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockRejectedValue(new Error('network'));

      renderDetail();

      expect(
        await screen.findByText(
          'The amount paid against this certificate could not be loaded. The certificate itself is unaffected.',
        ),
      ).toBeInTheDocument();
      // The document itself is unaffected — the headline figure is still there.
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('$47,500.00');
    });
  });

  describe('when the stored gross disagrees with the certificate own lines', () => {
    it('shows both figures rather than picking one', async () => {
      vi.mocked(getIpc).mockResolvedValue(
        certificate({ certifiedTotal: '50500.00', totalCertifiedAmount: '50000.00' }),
      );
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
        totalAllocated: 0,
        status: 'UNPAID',
      });

      renderDetail();

      expect(await screen.findByText(/records a gross total of \$50,500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/lines add up to \$50,000\.00/)).toBeInTheDocument();
    });

    it('says nothing when the two agree', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
        totalAllocated: 0,
        status: 'UNPAID',
      });

      renderDetail();

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByText(/records a gross total of/)).not.toBeInTheDocument();
    });
  });

  it('warns that a superseded certificate must not be paid against', async () => {
    vi.mocked(getIpc).mockResolvedValue(
      certificate({
        isEffective: false,
        supersededAt: '2026-07-01T00:00:00.000Z',
        supersessionReason: 'Re-measured after site inspection',
      }),
    );
    vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
      totalAllocated: 0,
      status: 'UNPAID',
    });

    renderDetail();

    expect(await screen.findByText(/must not be paid against/)).toBeInTheDocument();
    expect(screen.getByText(/Re-measured after site inspection/)).toBeInTheDocument();
  });

  it('shows a certified line with the reason the certifier cut it', async () => {
    vi.mocked(getIpc).mockResolvedValue(
      certificate({
        items: [
          {
            id: 'item-1',
            certificateId: 'ipc-1',
            applicationItemId: 'appitem-abcd1234',
            certifiedQuantity: '90',
            certifiedAmount: '45000.00',
            varianceQuantity: '-10',
            varianceReason: 'Excavation not complete at cut-off',
          },
        ],
      }),
    );
    vi.mocked(getCertificatePaymentStatus).mockResolvedValue({
      totalAllocated: 0,
      status: 'UNPAID',
    });

    renderDetail();

    expect(await screen.findByText(/Excavation not complete at cut-off/)).toBeInTheDocument();
    expect(screen.getByText('$45,000.00')).toBeInTheDocument();
  });

  it('reports a missing certificate distinctly from a failure', async () => {
    vi.mocked(getIpc).mockRejectedValue(new ApiError(404, 'gone', 'NOT_FOUND'));

    renderDetail();

    expect(await screen.findByText('This certificate no longer exists.')).toBeInTheDocument();
  });
});
