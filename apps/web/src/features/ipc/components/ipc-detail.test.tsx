import {
  BillingModel,
  ContractStatus,
  IpaStatus,
  IpcStatus,
  MeasurementMethod,
  PricingBasis,
} from '@erp/types';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { getCertificatePaymentStatus, getIpc, listIpcs } from '@/features/ipc/api/ipc-api';
import { getContract } from '@/features/contracts/api/contracts-api';
import { getIpa } from '@/features/ipa/api/ipa-api';
import { getBoqTree } from '@/features/boq/api/boq-api';
import type { ContractDetail } from '@/features/contracts/types';
import type { BoqTreeNode, IpaDetail as IpaDetailType } from '@/lib/api-types';
import type {
  CertificatePaymentStatus,
  IpcDetail as IpcDetailType,
} from '@/features/ipc/types';
import { ApiError } from '@/lib/api-client';

import { IpcDetail } from './ipc-detail';

vi.mock('@/features/ipc/api/ipc-api', () => ({
  listIpcs: vi.fn(),
  getIpc: vi.fn(),
  getCertificatePaymentStatus: vi.fn(),
}));

// The screen walks certificate → application → BOQ to put a description on each certified
// line, because the certificate itself carries only an `applicationItemId` (C15).
vi.mock('@/features/ipa/api/ipa-api', () => ({ getIpa: vi.fn(), listIpas: vi.fn() }));
vi.mock('@/features/boq/api/boq-api', () => ({ getBoqTree: vi.fn(), getBoq: vi.fn() }));

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

/**
 * An application carrying one item, so a certified line can be walked back to its BOQ node.
 * Only `id` and `boqNodeId` are read by the screen; the rest satisfies the response shape.
 */
function application(): IpaDetailType {
  return {
    id: 'ipa-1',
    contractId: 'con-1',
    organizationId: 'org-1',
    applicationNumber: 1,
    applicationRef: 'IPA-001',
    status: IpaStatus.SUBMITTED,
    periodFrom: null,
    periodTo: null,
    submittedAt: '2026-05-01T00:00:00.000Z',
    submittedBy: 'user-1',
    exchangeRateCurrency: null,
    exchangeRateBase: null,
    exchangeRateValue: null,
    exchangeRateDate: null,
    notes: null,
    createdBy: 'user-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    items: [
      {
        id: 'appitem-abcd1234',
        applicationId: 'ipa-1',
        boqNodeId: 'boq-1',
        measurementMethodSnapshot: MeasurementMethod.QUANTITY,
        unitRateSnapshot: '500.00',
        currencySnapshot: 'USD',
        cumulativeClaimed: '100',
        previousEffectiveCertified: '0',
        periodQuantity: '100',
        periodAmount: '50000.00',
      },
    ],
    deductions: [],
    attachments: [],
    totalPeriodAmount: '50000.00',
    totalDeductions: '0.00',
    netPayable: '50000.00',
  };
}

/** The BOQ node `application()`'s only item points at. */
function boqNode(): BoqTreeNode {
  return {
    id: 'boq-1',
    boqId: 'boq-root',
    versionId: 'bv-1',
    parentId: null,
    path: 'boq-1',
    depth: 0,
    sortOrder: 1,
    code: 'A.1',
    description: 'Excavation to reduced level',
    descriptionAr: 'الحفر إلى المنسوب المخفض',
    measurementMethod: MeasurementMethod.QUANTITY,
    pricingBasis: PricingBasis.UNIT_RATE,
    unit: 'm3',
    quantity: '120',
    unitRate: '500.00',
    currency: 'USD',
    totalAmount: '60000.00',
    isLeaf: true,
    originNodeId: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    children: [],
    computedTotal: 60000,
  };
}

/** A certified line pointing at `application()`'s item, cut by 10 against the claim. */
function certifiedLine() {
  return {
    id: 'item-1',
    certificateId: 'ipc-1',
    applicationItemId: 'appitem-abcd1234',
    certifiedQuantity: '90',
    certifiedAmount: '45000.00',
    varianceQuantity: '-10',
    varianceReason: 'Excavation not complete at cut-off',
  };
}

/**
 * A payment-status response. All three fields are decimal strings — `totalAllocated` was a
 * JS number until C8 was fixed, and `settlementFor` guarded it with `Number.isFinite`,
 * which is false for a string. Mocking a number here is what hid that.
 *
 * Every certificate in this file nets to 47,500 (gross 50,000 less 2,500 retention) — the
 * shape C7 (#11) could not report as paid.
 */
function payment(
  totalAllocated: string,
  status: CertificatePaymentStatus['status'],
): CertificatePaymentStatus {
  return { totalAllocated, netCertified: '47500.00', status };
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
  vi.mocked(listIpcs).mockReset();
  vi.mocked(getIpa).mockReset();
  vi.mocked(getBoqTree).mockReset();
  vi.mocked(getContract).mockResolvedValue(contract());
  // The sibling-certificate, application and BOQ lookups are incidental to most of these
  // tests, but a query function returning `undefined` is a React Query error rather than an
  // empty result — so they get empty defaults instead of being left unmocked.
  vi.mocked(listIpcs).mockResolvedValue([]);
  vi.mocked(getBoqTree).mockResolvedValue([]);
  vi.mocked(getIpa).mockResolvedValue(application());
  // Every test renders the settlement section, so give it a default rather than leaving the
  // query resolving undefined in the tests that are not about payment.
  vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('0.00', 'UNPAID'));
});

function renderDetail() {
  return renderWithProviders(<IpcDetail contractId="con-1" ipaId="ipa-1" ipcId="ipc-1" />);
}

describe('IpcDetail', () => {
  it('leads with the net certified amount, which is what the client owes', async () => {
    vi.mocked(getIpc).mockResolvedValue(certificate());
    vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('0.00', 'UNPAID'));

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
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('47500.00', 'PARTIALLY_PAID'));

      renderDetail();

      expect(await screen.findByText('Paid')).toBeInTheDocument();
      expect(screen.queryByText('Partly paid')).not.toBeInTheDocument();
    });

    it('shows what has been allocated and what is still outstanding', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('20000.00', 'PARTIALLY_PAID'));

      renderDetail();

      expect(await screen.findByText('Partly paid')).toBeInTheDocument();
      expect(screen.getByText('$20,000.00')).toBeInTheDocument();
      expect(screen.getByText('$27,500.00')).toBeInTheDocument();
    });

    it('flags a certificate with more allocated against it than it is worth', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('48000.00', 'PAID'));

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
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('0.00', 'UNPAID'));

      renderDetail();

      expect(await screen.findByText(/records a gross total of \$50,500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/lines add up to \$50,000\.00/)).toBeInTheDocument();
    });

    it('says nothing when the two agree', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());
      vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('0.00', 'UNPAID'));

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
    vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('0.00', 'UNPAID'));

    renderDetail();

    expect(await screen.findByText(/must not be paid against/)).toBeInTheDocument();
    expect(screen.getByText(/Re-measured after site inspection/)).toBeInTheDocument();
  });

  /**
   * The certificate names its lines only by `applicationItemId` (C15). Showing that raw is
   * unreadable, so the screen walks it back through the application to the BOQ node for a
   * description — and falls back to the id when that walk cannot complete.
   */
  describe('certified line labels', () => {
    it('describes a line using its BOQ node rather than an opaque id', async () => {
      vi.mocked(getBoqTree).mockResolvedValue([boqNode()]);
      vi.mocked(getIpc).mockResolvedValue(certificate({ items: [certifiedLine()] }));

      renderDetail();

      expect(await screen.findByText('Excavation to reduced level')).toBeInTheDocument();
      expect(screen.queryByText('abcd1234')).not.toBeInTheDocument();
    });

    it('falls back to the id when the BOQ node cannot be resolved', async () => {
      vi.mocked(getBoqTree).mockResolvedValue([]);
      vi.mocked(getIpc).mockResolvedValue(certificate({ items: [certifiedLine()] }));

      renderDetail();

      expect(await screen.findByText('abcd1234')).toBeInTheDocument();
    });
  });

  it('shows a certified line with the reason the certifier cut it', async () => {
    vi.mocked(getIpc).mockResolvedValue(certificate({ items: [certifiedLine()] }));
    vi.mocked(getCertificatePaymentStatus).mockResolvedValue(payment('0.00', 'UNPAID'));

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
