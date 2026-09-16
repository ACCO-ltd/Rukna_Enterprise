import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CommercialGuaranteeSummary, CommercialSummaryResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { pickDate } from '@/test/pick-date';

import { ContractSecurityTab } from './contract-security-tab';

// The tab mounts `useContract` for the (unrelated) payment-terms/milestones panels, and
// `useAdvanceContract` for the lifecycle driver on the status panel. Stub both idle so the
// guarantee/retention/advance panels the test exercises stay isolated from a network round-trip.
vi.mock('@/features/contracts/hooks/use-contracts', () => ({
  useContract: vi.fn(() => ({ data: null, isPending: false, isError: false })),
  useAdvanceContract: vi.fn(() => ({ mutate: vi.fn(), isPending: false, failure: null })),
}));

// The dialog is wired to these mutations. Stubbing them lets the test assert the workspace submits
// through `useAddGuarantee` / `useUpdateGuarantee` without a network round-trip.
const addMutate = vi.fn();
const updateMutate = vi.fn();
vi.mock('@/features/contracts/hooks/use-contract-terms', () => ({
  useAddGuarantee: vi.fn(() => ({ mutate: addMutate, isPending: false, isError: false })),
  useUpdateGuarantee: vi.fn(() => ({ mutate: updateMutate, isPending: false, isError: false })),
}));

function guarantee(
  overrides: Partial<CommercialGuaranteeSummary> = {},
): CommercialGuaranteeSummary {
  return {
    id: 'g-1',
    guaranteeType: 'PERFORMANCE_BOND',
    reference: 'PB-001',
    issuer: 'Salaam Bank',
    beneficiary: 'ACCO',
    amount: '50000.00',
    currency: 'USD',
    issueDate: '2026-01-01',
    expiryDate: '2026-12-31',
    status: 'ACTIVE',
    attention: 'NONE',
    ...overrides,
  };
}

function summary(overrides: Partial<CommercialSummaryResponse> = {}): CommercialSummaryResponse {
  return {
    projectId: 'p-1',
    currency: 'USD',
    financialsVisible: true,
    contractValue: null,
    mainContract: {
      id: 'c-1',
      contractNumber: 'CN-2026-001',
      status: 'ACTIVE',
      clientName: 'ACCO',
      startDate: '2026-01-01T00:00:00.000Z',
      expectedEndDate: '2026-12-31T00:00:00.000Z',
      contractValue: '1000000.00',
      totalClientRevenue: '1000000.00',
      currency: 'USD',
      billingModel: 'MEASURED_IPC',
      boqVersionNumber: 3,
    },
    metrics: {
      contractValue: { state: 'OK', amount: '1000000.00', currency: 'USD', sourceCount: 1, drillTo: null, asOf: null },
      certifiedGross: { state: 'ZERO', amount: '0.00', currency: 'USD', sourceCount: 0, drillTo: null, asOf: null },
      certifiedNet: { state: 'ZERO', amount: '0.00', currency: 'USD', sourceCount: 0, drillTo: null, asOf: null },
      invoiced: { state: 'ZERO', amount: '0.00', currency: 'USD', sourceCount: 0, drillTo: null, asOf: null },
      received: { state: 'ZERO', amount: '0.00', currency: 'USD', sourceCount: 0, drillTo: null, asOf: null },
      outstanding: { state: 'ZERO', amount: '0.00', currency: 'USD', sourceCount: 0, drillTo: null, asOf: null },
      uninvoicedCertified: { state: 'ZERO', amount: '0.00', currency: 'USD', sourceCount: 0, drillTo: null, asOf: null },
    },
    certification: { applicationsSubmitted: 0, effectiveCertificates: 0, postedInvoices: 0 },
    receivables: { collectionRate: 0, outstandingInvoices: [] },
    retention: null,
    advances: [],
    securityPosition: {
      applicable: false,
      retentionHeld: null,
      advanceRecovered: null,
      advanceOutstanding: null,
    },
    guarantees: [guarantee()],
    attention: [],
    capabilities: {
      canViewFinancials: true,
      canEditContract: false,
      canAdvanceContract: false,
      canCreateApplication: false,
      canManageApplication: false,
      canReviewApplication: false,
      canIssueCertificate: false,
      canGenerateInvoice: false,
      canPostInvoice: false,
      canManageGuarantee: true,
      canRecordReceipt: false,
      canAllocateReceipt: false,
    },
    recentActivity: [],
    asOf: '2026-08-14T00:00:00.000Z',
    ...overrides,
  };
}

function renderTab(overrides: Partial<CommercialSummaryResponse> = {}) {
  return renderWithProviders(<ContractSecurityTab projectId="p-1" summary={summary(overrides)} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Commercial workspace — guarantee authoring', () => {
  it('opens an in-workspace add dialog instead of navigating to /contracts/:id', async () => {
    const user = userEvent.setup();
    renderTab();

    // The regression: the add affordance must not be a link to the contract page (which loops
    // back to this workspace after the P3 fold-in).
    const addButton = screen.getByRole('button', { name: 'Add guarantee' });
    expect(addButton).not.toHaveAttribute('href');

    await user.click(addButton);

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('heading', { name: 'Add guarantee' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Guarantee type')).toBeInTheDocument();
  });

  it('never renders a /contracts/:id link anywhere in the guarantees panel', () => {
    renderTab();

    // The broken affordance was `<Link href="/contracts/c-1">`. Assert no anchor points there.
    // Payment-terms panel links to /projects/.../boq etc.; only the contract-page loop is forbidden.
    const contractLinks = Array.from(document.querySelectorAll('a[href]')).filter((a) =>
      (a.getAttribute('href') ?? '').startsWith('/contracts/'),
    );
    expect(contractLinks).toHaveLength(0);
  });

  it('submits a new guarantee through useAddGuarantee', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'Add guarantee' }));
    const dialog = await screen.findByRole('dialog');

    // Guarantee type defaults to PERFORMANCE — leave it, then fill the rest.
    await user.type(within(dialog).getByLabelText('Amount'), '50000');
    await user.type(within(dialog).getByLabelText('Issuer'), 'Salaam Bank');
    await user.type(within(dialog).getByLabelText('Beneficiary'), 'ACCO');
    await pickDate(user, within(dialog).getByLabelText('Issue date'), '2026-03-01');
    await pickDate(user, within(dialog).getByLabelText('Expiry date'), '2026-09-01');

    // The submit button and the title share the label; scope to the footer button.
    await user.click(within(dialog).getByRole('button', { name: 'Add guarantee' }));

    await waitFor(() => {
      expect(addMutate).toHaveBeenCalledTimes(1);
    });
    const [payload] = addMutate.mock.calls[0] as [Record<string, unknown>];
    expect(payload).toMatchObject({
      guaranteeType: 'PERFORMANCE',
      issuer: 'Salaam Bank',
      beneficiary: 'ACCO',
      issueDate: '2026-03-01',
      expiryDate: '2026-09-01',
      currency: 'USD',
    });
  });

  it('opens a pre-filled edit dialog from a row and submits through useUpdateGuarantee', async () => {
    const user = userEvent.setup();
    renderTab();

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Edit guarantee')).toBeInTheDocument();
    // The immutable facts are shown for context.
    expect(within(dialog).getByText('PERFORMANCE_BOND')).toBeInTheDocument();
    expect(within(dialog).getByText('Salaam Bank')).toBeInTheDocument();
    // Status is pre-filled from the row — the Radix trigger reflects the current status label.
    expect(within(dialog).getByLabelText('Status')).toHaveTextContent('Active');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(updateMutate).toHaveBeenCalledTimes(1);
    });
    const [payload] = updateMutate.mock.calls[0] as [Record<string, unknown>];
    // The status carries through pre-filled; the commercial facts are not part of the PATCH.
    expect(payload).toMatchObject({ guaranteeId: 'g-1', status: 'ACTIVE' });
    // Notes were never loaded for the row, so the PATCH must not carry a (blanking) notes field.
    expect(payload).not.toHaveProperty('notes');
  });

  it('hides both add and edit affordances when the user cannot manage guarantees', () => {
    renderTab({
      capabilities: { ...summary().capabilities, canManageGuarantee: false },
    });

    expect(screen.queryByRole('button', { name: 'Add guarantee' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
  });
});

/**
 * S-SH-4: the retention and advance panels appear only when the contract actually carries those
 * terms; the guarantees panel is always present. A MILESTONE contract holds no retention and no
 * standalone advance, so an empty "not applicable" card was noise, not information.
 */
describe('Contract tab — retention/advance shown only when configured (S-SH-4)', () => {
  it('hides the retention and advance panels when the contract has no such terms', () => {
    // The base summary already has retention: null, advances: [].
    renderTab();

    expect(screen.queryByRole('heading', { name: 'Retention' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Advances' })).not.toBeInTheDocument();
    // Guarantees stays regardless.
    expect(screen.getByRole('heading', { name: 'Guarantees' })).toBeInTheDocument();
  });

  it('renders the retention panel when the contract carries retention terms', () => {
    renderTab({
      retention: { retentionRate: '0.05', retentionCap: '0.10', retentionSplitOnPC: '0.5' },
      securityPosition: {
        applicable: true,
        retentionHeld: '25000.00',
        advanceRecovered: null,
        advanceOutstanding: null,
      },
    });

    expect(screen.getByRole('heading', { name: 'Retention' })).toBeInTheDocument();
    expect(screen.getByText('Retention rate')).toBeInTheDocument();
  });

  it('renders the advance panel when the contract carries advance terms', () => {
    renderTab({
      advances: [
        {
          id: 'a-1',
          advanceType: 'MOBILIZATION',
          description: null,
          amount: '100000.00',
          percentage: null,
          recoveryRate: '0.1000',
        },
      ],
      securityPosition: {
        applicable: true,
        retentionHeld: null,
        advanceRecovered: '10000.00',
        advanceOutstanding: '90000.00',
      },
    });

    expect(screen.getByRole('heading', { name: 'Advances' })).toBeInTheDocument();
  });
});
