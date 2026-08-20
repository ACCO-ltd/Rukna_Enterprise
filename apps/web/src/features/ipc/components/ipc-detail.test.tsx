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
import { getIpc, listIpcs } from '@/features/ipc/api/ipc-api';
import { getContract } from '@/features/contracts/api/contracts-api';
import { getIpa } from '@/features/ipa/api/ipa-api';
import { getBoqTree } from '@/features/boq/api/boq-api';
import type { ContractDetail } from '@/features/contracts/types';
import type { BoqTreeNode, IpaDetail as IpaDetailType } from '@/lib/api-types';
import type { IpcDetail as IpcDetailType } from '@/features/ipc/types';
import { ApiError } from '@/lib/api-client';

import { IpcDetail } from './ipc-detail';

vi.mock('@/features/ipc/api/ipc-api', () => ({
  listIpcs: vi.fn(),
  getIpc: vi.fn(),
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
    contractKind: 'CLIENT_CONTRACT' as const,
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
    measurementMethod: MeasurementMethod.QUANTITY,
    pricingBasis: PricingBasis.UNIT_RATE,
    unit: 'm3',
    quantity: '120',
    unitRate: '500.00',
    currency: 'USD',
    totalAmount: '60000.00',
    isLeaf: true,
    originNodeId: null,
    sourceType: 'BASELINE',
    sourceChangeOrderId: null,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    children: [],
    // A decimal string like every other money field since ADR-016 — it used to be the one
    // JSON number on this shape (B7).
    computedTotal: '60000.00',
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
});

function renderDetail() {
  return renderWithProviders(<IpcDetail contractId="con-1" ipaId="ipa-1" ipcId="ipc-1" />);
}

describe('IpcDetail', () => {
  it('leads with the net certified amount, which is what the client owes', async () => {
    vi.mocked(getIpc).mockResolvedValue(certificate());

    renderDetail();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('$47,500.00');
    expect(screen.getByText('Net certified')).toBeInTheDocument();
  });

  /**
   * A12 / ADR-017 CONST-COM-004. This screen used to derive a paid balance from
   * `GET /receipts/certificate/:id/payment-status`, which reads the legacy receipt->IPC
   * ledger. ADR-017 nominates receipt->invoice as the settlement authority, so the same
   * certificate could show one figure here and a different one in the Commercial workspace.
   * Settlement now belongs to the invoice, and the billing card links to it.
   */
  describe('settlement ownership', () => {
    it('states no paid balance of its own', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());

      renderDetail();
      await screen.findByRole('heading', { level: 1 });

      for (const label of ['Paid', 'Partly paid', 'Unpaid', 'Over-allocated']) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
      expect(screen.queryByText('Allocated')).not.toBeInTheDocument();
    });

  });

  describe('when the stored gross disagrees with the certificate own lines', () => {
    it('shows both figures rather than picking one', async () => {
      vi.mocked(getIpc).mockResolvedValue(
        certificate({ certifiedTotal: '50500.00', totalCertifiedAmount: '50000.00' }),
      );

      renderDetail();

      expect(await screen.findByText(/records a gross total of \$50,500\.00/)).toBeInTheDocument();
      expect(screen.getByText(/lines add up to \$50,000\.00/)).toBeInTheDocument();
    });

    it('says nothing when the two agree', async () => {
      vi.mocked(getIpc).mockResolvedValue(certificate());

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
