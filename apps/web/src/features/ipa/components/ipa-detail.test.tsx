import { BillingModel, ContractStatus, IpaStatus } from '@erp/types';
import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { getContract } from '@/features/contracts/api/contracts-api';
import { getIpa } from '@/features/ipa/api/ipa-api';
import { listIpcs } from '@/features/ipc/api/ipc-api';
import { getBoqTree } from '@/features/boq/api/boq-api';
import type { ContractDetail } from '@/features/contracts/types';
import type { IpaDetail as IpaDetailType } from '@/lib/api-types';
import { ApiError } from '@/lib/api-client';

import { IpaDetail } from './ipa-detail';

vi.mock('@/features/ipa/api/ipa-api', () => ({
  getIpa: vi.fn(),
  listIpas: vi.fn(),
  addIpaItem: vi.fn(),
  removeIpaItem: vi.fn(),
  addIpaDeduction: vi.fn(),
  removeIpaDeduction: vi.fn(),
}));

// The actions panel and the certificate list panel both read the certificates for this
// application; the items panel walks the BOQ. None are the subject of these tests, so they
// get empty defaults rather than being left to resolve undefined (a React Query error).
vi.mock('@/features/ipc/api/ipc-api', () => ({ listIpcs: vi.fn(), getIpc: vi.fn() }));
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

/** Gross 50,000 less 2,500 deductions = 47,500 net — three distinct figures. */
function application(overrides: Partial<IpaDetailType> = {}): IpaDetailType {
  return {
    id: 'ipa-1',
    contractId: 'con-1',
    organizationId: 'org-1',
    applicationNumber: 1,
    applicationRef: 'IPA-001',
    status: IpaStatus.DRAFT,
    periodFrom: '2026-05-01T00:00:00.000Z',
    periodTo: '2026-05-31T00:00:00.000Z',
    submittedAt: null,
    submittedBy: null,
    notes: null,
    createdBy: 'user-1',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    items: [],
    deductions: [],
    attachments: [],
    totalPeriodAmount: '50000.00',
    totalDeductions: '2500.00',
    netPayable: '47500.00',
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getIpa).mockReset();
  vi.mocked(getContract).mockReset();
  vi.mocked(listIpcs).mockReset();
  vi.mocked(getBoqTree).mockReset();
  vi.mocked(getContract).mockResolvedValue(contract());
  vi.mocked(listIpcs).mockResolvedValue([]);
  vi.mocked(getBoqTree).mockResolvedValue([]);
});

function renderDetail() {
  return renderWithProviders(<IpaDetail contractId="con-1" ipaId="ipa-1" />);
}

describe('IpaDetail', () => {
  it('leads with the net payable amount', async () => {
    vi.mocked(getIpa).mockResolvedValue(application());

    renderDetail();

    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('$47,500.00');
    expect(screen.getByText('Net payable')).toBeInTheDocument();
  });

  describe('summary', () => {
    it('lists gross, deductions, period and contract as definition rows', async () => {
      vi.mocked(getIpa).mockResolvedValue(application());

      renderDetail();

      const summary = await screen.findByRole('region', { name: 'Summary' });
      expect(within(summary).getByText('Period total')).toBeInTheDocument();
      expect(within(summary).getByText('$50,000.00')).toBeInTheDocument();
      expect(within(summary).getByText('Deductions')).toBeInTheDocument();
      expect(within(summary).getByText('$2,500.00')).toBeInTheDocument();
      expect(within(summary).getByText('Contract')).toBeInTheDocument();
      expect(within(summary).getByText('CON-001')).toBeInTheDocument();
    });

    it('does not restate the net payable in the summary — it lives in the header only', async () => {
      vi.mocked(getIpa).mockResolvedValue(application());

      renderDetail();

      const summary = await screen.findByRole('region', { name: 'Summary' });
      expect(within(summary).queryByText('$47,500.00')).not.toBeInTheDocument();
    });

    it('shows the period range when both dates are recorded', async () => {
      vi.mocked(getIpa).mockResolvedValue(application());

      renderDetail();

      const summary = await screen.findByRole('region', { name: 'Summary' });
      expect(within(summary).getByText(/–/)).toBeInTheDocument();
    });

    it('says no period is recorded when the dates are absent', async () => {
      vi.mocked(getIpa).mockResolvedValue(application({ periodFrom: null, periodTo: null }));

      renderDetail();

      const summary = await screen.findByRole('region', { name: 'Summary' });
      expect(within(summary).getByText('No period recorded')).toBeInTheDocument();
    });
  });

  it('reports a missing application distinctly from a failure', async () => {
    vi.mocked(getIpa).mockRejectedValue(new ApiError(404, 'gone', 'NOT_FOUND'));

    renderDetail();

    expect(await screen.findByText('This application no longer exists.')).toBeInTheDocument();
  });
});
