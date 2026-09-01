import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ApprovalPolicyVersionHistory,
  ApprovalPolicyVersionSummary,
} from '@erp/types';

import { renderWithProviders } from '@/test/render';

const hookMocks = vi.hoisted(() => ({
  useApprovalPolicyVersions: vi.fn(),
  useApprovalPolicyComparison: vi.fn(),
}));
vi.mock('../hooks/use-approval-policies', () => hookMocks);

import { PolicyVersionComparisonSheet } from './policy-version-comparison-sheet';

function version(overrides: Partial<ApprovalPolicyVersionSummary> = {}): ApprovalPolicyVersionSummary {
  return {
    id: 'v1',
    policyKey: 'PURCHASE_ORDER_APPROVAL',
    version: 1,
    status: 'ACTIVE',
    ruleCount: 2,
    effectiveFrom: null,
    effectiveTo: null,
    createdAt: '',
    updatedAt: '',
    ...overrides,
  };
}

function history(versions: ApprovalPolicyVersionSummary[]): ApprovalPolicyVersionHistory {
  return { policyKey: 'PURCHASE_ORDER_APPROVAL', versions };
}

beforeEach(() => {
  vi.clearAllMocks();
  hookMocks.useApprovalPolicyComparison.mockReturnValue({ data: undefined, isPending: false, isError: false });
});

describe('PolicyVersionComparisonSheet', () => {
  it('shows a loading skeleton while the history loads', () => {
    hookMocks.useApprovalPolicyVersions.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderWithProviders(
      <PolicyVersionComparisonSheet policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
    );
    // The sheet renders in a portal, so query the whole document, not the render container.
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces a history load failure', () => {
    hookMocks.useApprovalPolicyVersions.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderWithProviders(
      <PolicyVersionComparisonSheet policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('tells the user there is no earlier version to compare when there is a single version', () => {
    hookMocks.useApprovalPolicyVersions.mockReturnValue({
      data: history([version()]),
      isPending: false,
      isError: false,
    });
    renderWithProviders(
      <PolicyVersionComparisonSheet policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
    );
    expect(
      screen.getByText('This policy has only one version — there is no earlier version to compare it against.'),
    ).toBeInTheDocument();
    // The comparison hook must be disabled (both ids null) in the single-version case.
    expect(hookMocks.useApprovalPolicyComparison).toHaveBeenCalledWith(null, null);
  });

  it('renders comparison pickers when two versions exist', () => {
    hookMocks.useApprovalPolicyVersions.mockReturnValue({
      data: history([version({ id: 'v2', version: 2, status: 'DRAFT' }), version({ id: 'v1', version: 1 })]),
      isPending: false,
      isError: false,
    });
    renderWithProviders(
      <PolicyVersionComparisonSheet policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
    );
    expect(screen.getByLabelText('Base (from)')).toBeInTheDocument();
    expect(screen.getByLabelText('Target (to)')).toBeInTheDocument();
    // Default base = previous (v1), target = newest (v2), which are distinct.
    expect(hookMocks.useApprovalPolicyComparison).toHaveBeenCalledWith('v1', 'v2');
  });
});
