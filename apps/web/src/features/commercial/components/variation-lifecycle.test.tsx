import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VariationOrderResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-commercial';

import { VariationDetailSheet } from './variation-detail-sheet';
import { ExtensionOfTimeSection } from './extension-of-time-section';

vi.mock('../hooks/use-commercial', () => ({
  useVariation: vi.fn(),
  useExtensionsOfTime: vi.fn(),
  useSubmitVariation: vi.fn(),
  useInternalApproveVariation: vi.fn(),
  useClientApproveVariation: vi.fn(),
  useRejectVariation: vi.fn(),
  useWithdrawVariation: vi.fn(),
  useGrantExtensionOfTime: vi.fn(),
}));

const MANAGE = ['manage:contract', 'approve:contract'];

function variation(overrides: Partial<VariationOrderResponse> = {}): VariationOrderResponse {
  return {
    id: 'vo-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'DRAFT',
    title: 'Additional foundations',
    description: null,
    proposedTimeImpactDays: 14,
    netPrice: '25000.00',
    lines: [{ id: 'l-1', description: 'Piling', quantity: '10', unitRate: '2500', amount: '25000.00', sortOrder: 0 }],
    createdBy: 'u-1',
    submittedBy: null,
    submittedAt: null,
    internalApprovedBy: null,
    internalApprovedAt: null,
    clientApprovedBy: null,
    clientApprovedAt: null,
    clientApprovalReference: null,
    rejectedBy: null,
    rejectedAt: null,
    reason: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

// Returns a bare idle mutation object; each mockReturnValue casts it to its hook's exact type.
function idleMutation(): { mutate: ReturnType<typeof vi.fn>; isPending: boolean } {
  return { mutate: vi.fn(), isPending: false };
}

function stubMutations() {
  vi.mocked(hooks.useSubmitVariation).mockReturnValue(
    idleMutation() as unknown as ReturnType<typeof hooks.useSubmitVariation>,
  );
  vi.mocked(hooks.useInternalApproveVariation).mockReturnValue(
    idleMutation() as unknown as ReturnType<typeof hooks.useInternalApproveVariation>,
  );
  vi.mocked(hooks.useClientApproveVariation).mockReturnValue(
    idleMutation() as unknown as ReturnType<typeof hooks.useClientApproveVariation>,
  );
  vi.mocked(hooks.useRejectVariation).mockReturnValue(
    idleMutation() as unknown as ReturnType<typeof hooks.useRejectVariation>,
  );
  vi.mocked(hooks.useWithdrawVariation).mockReturnValue(
    idleMutation() as unknown as ReturnType<typeof hooks.useWithdrawVariation>,
  );
}

function stubVariation(data: VariationOrderResponse) {
  vi.mocked(hooks.useVariation).mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useVariation>);
}

beforeEach(() => {
  vi.clearAllMocks();
  stubMutations();
});

function renderDetail() {
  return renderWithProviders(
    <VariationDetailSheet
      variationId="vo-1"
      contractId="c-1"
      projectId="p-1"
      currency="USD"
      open
      onOpenChange={() => {}}
    />,
    { permissions: MANAGE, withToast: true },
  );
}

describe('VariationDetailSheet — actions gated by real status', () => {
  it('DRAFT offers Submit and Withdraw, never Internal approve or Client approve', () => {
    stubVariation(variation({ status: 'DRAFT' }));
    renderDetail();
    expect(screen.getByRole('button', { name: 'Submit for approval' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Internal approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record client approval' })).not.toBeInTheDocument();
  });

  it('PENDING_INTERNAL offers Internal approve + Reject, never Submit', () => {
    stubVariation(variation({ status: 'PENDING_INTERNAL' }));
    renderDetail();
    expect(screen.getByRole('button', { name: 'Internal approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
  });

  it('INTERNAL_APPROVED offers Record client approval, never Internal approve', () => {
    stubVariation(variation({ status: 'INTERNAL_APPROVED' }));
    renderDetail();
    expect(screen.getByRole('button', { name: 'Record client approval' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Internal approve' })).not.toBeInTheDocument();
  });

  it('CLIENT_APPROVED is terminal — read-only, no lifecycle actions', () => {
    stubVariation(variation({ status: 'CLIENT_APPROVED', clientApprovalReference: 'SIGNED-42' }));
    renderDetail();
    // The footer Close exists (alongside the sheet's own dismiss control).
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record client approval' })).not.toBeInTheDocument();
  });
});

describe('VariationDetailSheet — actions gated by permission', () => {
  it('a read-only user on a DRAFT sees no lifecycle action, only Close', () => {
    stubVariation(variation({ status: 'DRAFT' }));
    renderWithProviders(
      <VariationDetailSheet
        variationId="vo-1"
        contractId="c-1"
        projectId="p-1"
        currency="USD"
        open
        onOpenChange={() => {}}
      />,
      { permissions: ['view:contract'], withToast: true },
    );
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
    // No lifecycle primary — the footer Close remains (plus the sheet's own dismiss control).
    expect(screen.getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });

  it('a manager without approve cannot internal-approve a PENDING_INTERNAL VO', () => {
    stubVariation(variation({ status: 'PENDING_INTERNAL' }));
    renderWithProviders(
      <VariationDetailSheet
        variationId="vo-1"
        contractId="c-1"
        projectId="p-1"
        currency="USD"
        open
        onOpenChange={() => {}}
      />,
      { permissions: ['manage:contract'], withToast: true },
    );
    // Approve/Reject require approve:contract; withdraw requires manage:contract.
    expect(screen.queryByRole('button', { name: 'Internal approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Withdraw' })).toBeInTheDocument();
  });
});

describe('VariationDetailSheet — client approval captures a reference', () => {
  it('requires clientApprovalReference and sends it on confirm', async () => {
    const user = userEvent.setup();
    const clientMutate = vi.fn();
    vi.mocked(hooks.useClientApproveVariation).mockReturnValue({
      mutate: clientMutate,
      isPending: false,
    } as unknown as ReturnType<typeof hooks.useClientApproveVariation>);
    stubVariation(variation({ status: 'INTERNAL_APPROVED' }));
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'Record client approval' }));

    // Confirm is blocked until a reference is supplied.
    const confirm = screen.getByRole('button', { name: 'Confirm client approval' });
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Client approval reference'), 'SIGNED-VO-42');
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(clientMutate).toHaveBeenCalledTimes(1));
    expect(clientMutate.mock.calls[0]![0]).toMatchObject({ clientApprovalReference: 'SIGNED-VO-42' });
  });
});

// ─── Extension of Time ──────────────────────────────────────────────────────────

function stubExtensions(currentEndDate: string | null) {
  vi.mocked(hooks.useExtensionsOfTime).mockReturnValue({
    isPending: false,
    isError: false,
    data: { contractId: 'c-1', currentEndDate, extensions: [] },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useExtensionsOfTime>);
}

describe('ExtensionOfTimeSection — explicit record flow', () => {
  it('records an extension with new date + reason, and cited VOs as justification', async () => {
    const user = userEvent.setup();
    const grantMutate = vi.fn();
    vi.mocked(hooks.useGrantExtensionOfTime).mockReturnValue({
      mutate: grantMutate,
      isPending: false,
    } as unknown as ReturnType<typeof hooks.useGrantExtensionOfTime>);
    stubExtensions('2027-01-01T00:00:00.000Z');

    renderWithProviders(
      <ExtensionOfTimeSection
        contractId="c-1"
        projectId="p-1"
        variations={[
          {
            id: 'vo-1',
            reference: 'VO-001',
            status: 'CLIENT_APPROVED',
            title: 'Additional foundations',
            proposedTimeImpactDays: 14,
          } as unknown as Parameters<typeof ExtensionOfTimeSection>[0]['variations'][number],
        ]}
      />,
      { permissions: MANAGE, withToast: true },
    );

    await user.click(screen.getByRole('button', { name: 'Record extension of time' }));

    const dialog = screen.getByRole('dialog');
    await user.type(within(dialog).getByLabelText('New completion date'), '2027-03-31');
    await user.type(within(dialog).getByLabelText('Reason'), 'Weather delay');
    // Cite the VO as justification.
    await user.click(within(dialog).getByRole('checkbox'));

    await user.click(within(dialog).getByRole('button', { name: 'Record extension' }));

    await waitFor(() => expect(grantMutate).toHaveBeenCalledTimes(1));
    const payload = grantMutate.mock.calls[0]![0];
    expect(payload.newEndDate).toBe('2027-03-31');
    expect(payload.reason).toBe('Weather delay');
    expect(payload.variationOrderIds).toEqual(['vo-1']);
  });

  it('hides the record action from a read-only user', () => {
    stubExtensions('2027-01-01T00:00:00.000Z');
    renderWithProviders(
      <ExtensionOfTimeSection contractId="c-1" projectId="p-1" variations={[]} />,
      { permissions: ['view:contract'], withToast: true },
    );
    expect(
      screen.queryByRole('button', { name: 'Record extension of time' }),
    ).not.toBeInTheDocument();
  });
});
