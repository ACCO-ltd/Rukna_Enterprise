import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { VariationOrderResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import { pickDate } from '@/test/pick-date';
import { ApiError } from '@/lib/api-client';
import * as hooks from '../hooks/use-commercial';

import { VariationDetailSheet } from './variation-detail-sheet';
import type { VariationBilling } from './variation-billing-chip';
import { ExtensionOfTimeSection } from './extension-of-time-section';

vi.mock('../hooks/use-commercial', () => ({
  useVariation: vi.fn(),
  useExtensionsOfTime: vi.fn(),
  useReverseVariation: vi.fn(),
  useGrantExtensionOfTime: vi.fn(),
}));

const MANAGE = ['manage:contract', 'approve:contract'];

function variation(overrides: Partial<VariationOrderResponse> = {}): VariationOrderResponse {
  return {
    id: 'vo-1',
    contractId: 'c-1',
    reference: 'VO-001',
    status: 'CLIENT_APPROVED',
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
    clientApprovedBy: 'u-2',
    clientApprovedAt: '2026-08-02T00:00:00.000Z',
    clientApprovalReference: 'SIGNED-42',
    rejectedBy: null,
    rejectedAt: null,
    reason: null,
    appliedToBoq: true,
    boqNodeCount: 6,
    boqAppliedAt: '2026-08-02T00:00:00.000Z',
    boqAppliedVersionId: 'ver-1',
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
  vi.mocked(hooks.useReverseVariation).mockReturnValue(
    idleMutation() as unknown as ReturnType<typeof hooks.useReverseVariation>,
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

function renderDetail(
  props: Partial<Parameters<typeof VariationDetailSheet>[0]> = {},
) {
  return renderWithProviders(
    <VariationDetailSheet
      variationId="vo-1"
      contractId="c-1"
      projectId="p-1"
      currency="USD"
      billing={null}
      canReverse
      open
      onOpenChange={() => {}}
      {...props}
    />,
    { permissions: MANAGE, withToast: true },
  );
}

describe('VariationDetailSheet — read-only ledger (variation-collapse)', () => {
  it('shows no approval-chain actions — the workflow is gone', () => {
    stubVariation(variation({ status: 'CLIENT_APPROVED' }));
    renderDetail();
    expect(screen.queryByRole('button', { name: 'Submit for approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Internal approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record client approval' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Withdraw' })).not.toBeInTheDocument();
  });

  it('surfaces the contract raise, BOQ-applied status and the client approval reference', () => {
    stubVariation(variation({ status: 'CLIENT_APPROVED', appliedToBoq: true, boqNodeCount: 6 }));
    renderDetail();
    expect(screen.getByText('Contract & BOQ impact')).toBeInTheDocument();
    expect(screen.getByText(/Raised by/)).toBeInTheDocument();
    expect(screen.getByText(/6 items/)).toBeInTheDocument();
    expect(screen.getByText('SIGNED-42')).toBeInTheDocument();
  });
});

describe('VariationDetailSheet — Reverse action', () => {
  it('offers Reverse for an adopted, unbilled, client-approved VO when permitted', () => {
    stubVariation(variation({ status: 'CLIENT_APPROVED', appliedToBoq: true }));
    renderDetail({ canReverse: true, billing: null });
    expect(screen.getByRole('button', { name: 'Reverse variation' })).toBeInTheDocument();
  });

  it('hides Reverse without the capability', () => {
    stubVariation(variation({ status: 'CLIENT_APPROVED', appliedToBoq: true }));
    renderDetail({ canReverse: false, billing: null });
    expect(screen.queryByRole('button', { name: 'Reverse variation' })).not.toBeInTheDocument();
  });

  it('hides Reverse once the variation is billed', () => {
    const billing: VariationBilling = {
      treatment: 'INVOICE',
      invoice: {
        id: 'inv-9',
        invoiceNumber: 'INV-005',
        subtotal: '25000.00',
        totalAmount: '26250.00',
        documentStatus: 'POSTED',
        postingStatus: 'POSTED',
      } as unknown as VariationBilling['invoice'],
    };
    stubVariation(variation({ status: 'CLIENT_APPROVED', appliedToBoq: true }));
    renderDetail({ canReverse: true, billing });
    expect(screen.queryByRole('button', { name: 'Reverse variation' })).not.toBeInTheDocument();
  });

  it('confirms with an optional reason and calls reverse on confirm', async () => {
    const user = userEvent.setup();
    const reverseMutate = vi.fn();
    vi.mocked(hooks.useReverseVariation).mockReturnValue({
      mutate: reverseMutate,
      isPending: false,
    } as unknown as ReturnType<typeof hooks.useReverseVariation>);
    stubVariation(variation({ status: 'CLIENT_APPROVED', appliedToBoq: true }));
    renderDetail({ canReverse: true, billing: null });

    await user.click(screen.getByRole('button', { name: 'Reverse variation' }));

    // The warning is shown before the destructive confirm.
    expect(
      screen.getByText(/removes the variation from the contract and lowers the contract value/i),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText(/Reason/i), 'Client withdrew the request');
    // The footer confirm shares the label; there are now two "Reverse variation" controls, so
    // target the destructive one explicitly by clicking the confirm in the footer.
    const confirmButtons = screen.getAllByRole('button', { name: 'Reverse variation' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    await waitFor(() => expect(reverseMutate).toHaveBeenCalledTimes(1));
    expect(reverseMutate.mock.calls[0]![0]).toMatchObject({ reason: 'Client withdrew the request' });
  });

  it('surfaces a 409 server message inline (e.g. already billed)', async () => {
    const user = userEvent.setup();
    const reverseMutate = vi.fn((_payload, opts?: { onError?: (e: unknown) => void }) => {
      opts?.onError?.(
        new ApiError(409, 'This variation has already been billed.', undefined, [
          'This variation has already been billed.',
        ]),
      );
    });
    vi.mocked(hooks.useReverseVariation).mockReturnValue({
      mutate: reverseMutate,
      isPending: false,
    } as unknown as ReturnType<typeof hooks.useReverseVariation>);
    stubVariation(variation({ status: 'CLIENT_APPROVED', appliedToBoq: true }));
    renderDetail({ canReverse: true, billing: null });

    await user.click(screen.getByRole('button', { name: 'Reverse variation' }));
    const confirmButtons = screen.getAllByRole('button', { name: 'Reverse variation' });
    await user.click(confirmButtons[confirmButtons.length - 1]!);

    expect(await screen.findByText('This variation has already been billed.')).toBeInTheDocument();
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
    await pickDate(user, within(dialog).getByLabelText('New completion date'), '2027-03-31');
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
