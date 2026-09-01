import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import type { ApprovalPolicySummary } from '../api/workflows-api';

/**
 * The clone dialog.
 *
 * A clone is the rollback / edit-an-active-version path, and the server records the reason on the
 * audit entry — so the reason is required. The tests lock that the confirm stays disabled until a
 * reason of at least three characters is present, and that a valid submit forwards the trimmed
 * reason. The rollback-impact preview is stubbed to the no-active-version branch to keep the clone
 * behaviour isolated.
 */

const hookMocks = vi.hoisted(() => ({
  useCloneApprovalPolicy: vi.fn(),
  useApprovalPolicyVersions: vi.fn(),
  useApprovalPolicyComparison: vi.fn(),
}));
vi.mock('../hooks/use-approval-policies', () => hookMocks);

import { ClonePolicyDialog } from './clone-policy-dialog';

function policy(overrides: Partial<ApprovalPolicySummary> = {}): ApprovalPolicySummary {
  return {
    id: 'p1',
    policyKey: 'PURCHASE_ORDER_APPROVAL',
    version: 3,
    status: 'ACTIVE',
    effectiveFrom: null,
    effectiveTo: null,
    amountBasis: 'NET_USD',
    notes: null,
    ruleCount: 2,
    updatedAt: '',
    ...overrides,
  };
}

function mutationState(over: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean; isError: boolean; error: unknown }> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  // No active version of this key → the preview shows the "nothing to compare" branch and the
  // comparison query stays disabled. Keeps the clone behaviour under test isolated.
  hookMocks.useApprovalPolicyVersions.mockReturnValue({
    data: { policyKey: 'PURCHASE_ORDER_APPROVAL', versions: [] },
    isPending: false,
    isError: false,
  });
  hookMocks.useApprovalPolicyComparison.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe('ClonePolicyDialog', () => {
  it('keeps confirm disabled until a reason of at least three characters is entered', async () => {
    hookMocks.useCloneApprovalPolicy.mockReturnValue(mutationState());
    renderWithProviders(
      <ClonePolicyDialog policy={policy()} open onOpenChange={() => {}} onCloned={() => {}} />,
    );

    expect(screen.getByRole('button', { name: 'Clone to draft' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Reason/), 'ab');
    expect(screen.getByRole('button', { name: 'Clone to draft' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Reason/), 'c');
    expect(screen.getByRole('button', { name: 'Clone to draft' })).toBeEnabled();
  });

  it('clones with the trimmed reason on submit', async () => {
    const state = mutationState();
    hookMocks.useCloneApprovalPolicy.mockReturnValue(state);
    renderWithProviders(
      <ClonePolicyDialog policy={policy()} open onOpenChange={() => {}} onCloned={() => {}} />,
    );

    await userEvent.type(screen.getByLabelText(/Reason/), '  rolling back a bad band  ');
    await userEvent.click(screen.getByRole('button', { name: 'Clone to draft' }));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0]).toMatchObject({
      id: 'p1',
      reason: 'rolling back a bad band',
    });
  });

  it('surfaces a clone failure', () => {
    hookMocks.useCloneApprovalPolicy.mockReturnValue(mutationState({ isError: true }));
    renderWithProviders(
      <ClonePolicyDialog policy={policy()} open onOpenChange={() => {}} onCloned={() => {}} />,
    );

    expect(screen.getByText('Could not clone this policy version.')).toBeInTheDocument();
  });
});
