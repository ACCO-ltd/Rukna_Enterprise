import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AtRiskCommencementResponse, VariationOrderResponse } from '@erp/types';

import { renderWithProviders } from '@/test/render';
import * as hooks from '../hooks/use-commercial';

import { AtRiskCommencementSection } from './at-risk-commencement-section';

vi.mock('../hooks/use-commercial', () => ({
  useAtRiskCommencements: vi.fn(),
  useRecordAtRiskCommencement: vi.fn(),
}));

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
    lines: [],
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
    appliedToBoq: false,
    boqNodeCount: 0,
    boqAppliedAt: null,
    boqAppliedVersionId: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function authorisation(
  overrides: Partial<AtRiskCommencementResponse> = {},
): AtRiskCommencementResponse {
  return {
    id: 'ar-1',
    variationOrderId: 'vo-1',
    variationReference: 'VO-001',
    exposureAmount: '40000.00',
    currency: 'USD',
    capAmount: '25000.00',
    ceoRequired: true,
    constructionDirectorUserId: 'cd-1',
    cfoUserId: 'cfo-1',
    ceoUserId: 'ceo-1',
    reason: 'Client verbally instructed urgent piling',
    voStatusAtAuthorisation: 'PENDING_INTERNAL',
    authorisedBy: 'u-9',
    authorisedAt: '2026-08-10T00:00:00.000Z',
    createdAt: '2026-08-10T00:00:00.000Z',
    ...overrides,
  };
}

function stubList(data: AtRiskCommencementResponse[]) {
  vi.mocked(hooks.useAtRiskCommencements).mockReturnValue({
    isPending: false,
    isError: false,
    data,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof hooks.useAtRiskCommencements>);
}

function stubRecord(mutate = vi.fn()) {
  vi.mocked(hooks.useRecordAtRiskCommencement).mockReturnValue({
    mutate,
    isPending: false,
  } as unknown as ReturnType<typeof hooks.useRecordAtRiskCommencement>);
  return mutate;
}

function renderSection(vo: VariationOrderResponse, permissions = ['manage:contract']) {
  return renderWithProviders(
    <AtRiskCommencementSection
      variation={vo}
      contractId="c-1"
      projectId="p-1"
      canManage={permissions.includes('manage:contract')}
    />,
    { permissions, withToast: true },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  stubRecord();
});

describe('AtRiskCommencementSection — lists existing authorisations', () => {
  it('shows exposure, cap, CEO-required and who authorised, framed as an exception', () => {
    stubList([authorisation()]);
    renderSection(variation({ status: 'PENDING_INTERNAL' }));

    // Exposure + cap are the server's snapshotted figures.
    expect(screen.getByText(/40,000/)).toBeInTheDocument();
    expect(screen.getByText(/25,000/)).toBeInTheDocument();
    // The cap-rule outcome is a badge (server-provided, not derived here).
    expect(screen.getByText('CEO required')).toBeInTheDocument();
    // Framed as an audited exception that changes neither contract value nor BOQ.
    expect(screen.getByText(/exception, not the normal path/i)).toBeInTheDocument();
    expect(screen.getByText(/neither the contract value nor the BOQ/i)).toBeInTheDocument();
  });

  it('shows the empty note when nothing is recorded', () => {
    stubList([]);
    renderSection(variation({ status: 'DRAFT' }));
    expect(screen.getByText(/No at-risk commencement recorded/i)).toBeInTheDocument();
  });
});

describe('AtRiskCommencementSection — record action gating', () => {
  it('offers the record action in a pre-CLIENT_APPROVED state to a manager', () => {
    stubList([]);
    renderSection(variation({ status: 'INTERNAL_APPROVED' }));
    expect(
      screen.getByRole('button', { name: 'Record at-risk commencement' }),
    ).toBeInTheDocument();
  });

  it('hides the record action once the VO is CLIENT_APPROVED (starting early is moot)', () => {
    stubList([]);
    renderSection(variation({ status: 'CLIENT_APPROVED' }));
    expect(
      screen.queryByRole('button', { name: 'Record at-risk commencement' }),
    ).not.toBeInTheDocument();
  });

  it('hides the record action from a read-only user', () => {
    stubList([]);
    renderSection(variation({ status: 'DRAFT' }), ['view:contract']);
    expect(
      screen.queryByRole('button', { name: 'Record at-risk commencement' }),
    ).not.toBeInTheDocument();
  });
});

describe('AtRiskCommencementSection — record form validates + submits', () => {
  it('requires reason + exposure + CD + CFO, then sends the payload (CEO optional)', async () => {
    const user = userEvent.setup();
    const mutate = stubRecord();
    stubList([]);
    renderSection(variation({ status: 'DRAFT' }));

    await user.click(screen.getByRole('button', { name: 'Record at-risk commencement' }));

    const confirm = screen.getByRole('button', { name: 'Record authorisation' });
    // Blocked until the required fields are filled — reason above all.
    expect(confirm).toBeDisabled();

    await user.type(screen.getByLabelText('Exposure amount'), '40000');
    await user.type(screen.getByLabelText('Reason'), 'Urgent piling to hold the programme');
    await user.type(screen.getByLabelText('Construction Director'), 'cd-1');
    await user.type(screen.getByLabelText('CFO'), 'cfo-1');

    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const payload = mutate.mock.calls[0]![0];
    expect(payload).toMatchObject({
      exposureAmount: 40000,
      reason: 'Urgent piling to hold the programme',
      constructionDirectorUserId: 'cd-1',
      cfoUserId: 'cfo-1',
    });
    // CEO left empty ⇒ omitted, not sent as an empty string (the server decides if it is required).
    expect(payload.ceoUserId).toBeUndefined();
  });

  it('keeps confirm disabled while the reason is blank', async () => {
    const user = userEvent.setup();
    stubRecord();
    stubList([]);
    renderSection(variation({ status: 'DRAFT' }));

    await user.click(screen.getByRole('button', { name: 'Record at-risk commencement' }));

    await user.type(screen.getByLabelText('Exposure amount'), '40000');
    await user.type(screen.getByLabelText('Construction Director'), 'cd-1');
    await user.type(screen.getByLabelText('CFO'), 'cfo-1');
    // Reason still blank — the one field the client insists on before letting the server judge.
    expect(screen.getByRole('button', { name: 'Record authorisation' })).toBeDisabled();
  });
});
