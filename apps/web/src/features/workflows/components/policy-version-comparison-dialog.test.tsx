import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

import { PolicyVersionComparisonDialog } from './policy-version-comparison-dialog';

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

describe('PolicyVersionComparisonDialog', () => {
  it('shows a loading skeleton while the history loads', () => {
    hookMocks.useApprovalPolicyVersions.mockReturnValue({ data: undefined, isPending: true, isError: false });
    renderWithProviders(
      <PolicyVersionComparisonDialog policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
    );
    // The dialog renders in a portal, so query the whole document, not the render container.
    expect(document.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('is a read-only dialog: named by its title, with Close as the only action', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    hookMocks.useApprovalPolicyVersions.mockReturnValue({
      data: history([version({ id: 'v2', version: 2, status: 'DRAFT' }), version({ id: 'v1', version: 1 })]),
      isPending: false,
      isError: false,
    });
    renderWithProviders(
      <PolicyVersionComparisonDialog policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={onOpenChange} />,
    );

    const dialog = screen.getByRole('dialog', { name: /version comparison/i });
    const footerButtons = within(dialog)
      .getAllByRole('button')
      .filter((button) => button.textContent === 'Close');
    expect(footerButtons).toHaveLength(1);
    expect(within(dialog).queryByRole('button', { name: /save|submit/i })).not.toBeInTheDocument();

    await user.click(footerButtons[0]!);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('surfaces a history load failure', () => {
    hookMocks.useApprovalPolicyVersions.mockReturnValue({ data: undefined, isPending: false, isError: true });
    renderWithProviders(
      <PolicyVersionComparisonDialog policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
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
      <PolicyVersionComparisonDialog policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
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
      <PolicyVersionComparisonDialog policyKey="PURCHASE_ORDER_APPROVAL" onOpenChange={() => {}} />,
    );
    expect(screen.getByLabelText('Base (from)')).toBeInTheDocument();
    expect(screen.getByLabelText('Target (to)')).toBeInTheDocument();
    // Default base = previous (v1), target = newest (v2), which are distinct.
    expect(hookMocks.useApprovalPolicyComparison).toHaveBeenCalledWith('v1', 'v2');
  });
});
