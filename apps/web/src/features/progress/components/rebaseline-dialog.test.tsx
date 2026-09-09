import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VariationOrderListItem } from '@erp/types';

import { renderWithProviders } from '@/test/render';

const mocks = vi.hoisted(() => ({
  useCommercialSummary: vi.fn(),
  useVariations: vi.fn(),
  useRebaseline: vi.fn(),
}));

vi.mock('@/features/commercial/hooks/use-commercial', () => ({
  useCommercialSummary: mocks.useCommercialSummary,
  useVariations: mocks.useVariations,
}));
vi.mock('../hooks/use-progress', () => ({ useRebaseline: mocks.useRebaseline }));

import { RebaselineDialog } from './rebaseline-dialog';

const loaded = <T,>(data: T) => ({ data, isPending: false, isError: false, isFetching: false });
const pending = () => ({ data: undefined, isPending: true, isError: false, isFetching: true });

const VO: VariationOrderListItem = {
  id: 'vo-1',
  contractId: 'contract-1',
  reference: 'VO-001',
  status: 'CLIENT_APPROVED',
  title: 'Extra foundations',
  description: null,
  proposedTimeImpactDays: null,
  netPrice: '1000.00',
  createdBy: 'u1',
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
  createdAt: '2026-08-01',
  updatedAt: '2026-08-01',
  lineCount: 1,
  atRiskAuthorisationCount: 0,
  atRiskExposure: '0.00',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCommercialSummary.mockReturnValue(loaded({ mainContract: { id: 'contract-1' } }));
  mocks.useVariations.mockReturnValue(loaded({ contractId: 'contract-1', variations: [VO] }));
  mocks.useRebaseline.mockReturnValue({ mutate: vi.fn(), isPending: false });
});

describe('RebaselineDialog', () => {
  it('requires a Variation — the submit is disabled until one is selected', () => {
    renderWithProviders(
      <RebaselineDialog projectId="proj-1" open onOpenChange={() => {}} />,
      { withToast: true },
    );

    // The variation picker is present.
    expect(screen.getByLabelText('Variation')).toBeInTheDocument();
    // Nothing selected yet → the confirm is disabled (a re-baseline needs a Variation).
    expect(screen.getByRole('button', { name: 'Re-baseline' })).toBeDisabled();
  });

  it('does not call rebaseline when no variation is chosen', () => {
    const mutate = vi.fn();
    mocks.useRebaseline.mockReturnValue({ mutate, isPending: false });
    renderWithProviders(
      <RebaselineDialog projectId="proj-1" open onOpenChange={() => {}} />,
      { withToast: true },
    );

    screen.getByRole('button', { name: 'Re-baseline' }).click();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('handles "no main contract" gracefully — no picker, no submit', () => {
    mocks.useCommercialSummary.mockReturnValue(loaded({ mainContract: null }));
    mocks.useVariations.mockReturnValue({ ...loaded(undefined), data: undefined });
    renderWithProviders(
      <RebaselineDialog projectId="proj-1" open onOpenChange={() => {}} />,
      { withToast: true },
    );

    expect(screen.getByText(/no main contract yet/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-baseline' })).not.toBeInTheDocument();
  });

  it('handles "no variations" gracefully — a re-baseline needs a Variation', () => {
    mocks.useVariations.mockReturnValue(loaded({ contractId: 'contract-1', variations: [] }));
    renderWithProviders(
      <RebaselineDialog projectId="proj-1" open onOpenChange={() => {}} />,
      { withToast: true },
    );

    expect(screen.getByText(/no variations to cite/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-baseline' })).not.toBeInTheDocument();
  });

  it('shows a loading state while the contract/variations resolve', () => {
    mocks.useCommercialSummary.mockReturnValue(pending());
    mocks.useVariations.mockReturnValue({ ...pending(), data: undefined });
    renderWithProviders(
      <RebaselineDialog projectId="proj-1" open onOpenChange={() => {}} />,
      { withToast: true },
    );

    // No picker and no confirm while still loading.
    expect(screen.queryByLabelText('Variation')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Re-baseline' })).not.toBeInTheDocument();
  });
});
