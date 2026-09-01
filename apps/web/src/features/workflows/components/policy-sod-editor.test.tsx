import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';

import type { PolicySodRule } from '../api/workflows-api';

/**
 * The segregation-of-duties editor.
 *
 * The upsert keys on `code`, so add and toggle are the same endpoint: adding sends `isActive: true`;
 * toggling re-sends the code with the flag flipped. The tests lock both, and that the editor is
 * read-only (no add form, no toggle button) when the draft is not editable.
 */

const hookMocks = vi.hoisted(() => ({
  useApprovalPolicySodRules: vi.fn(),
  useUpsertApprovalPolicySodRule: vi.fn(),
}));
vi.mock('../hooks/use-approval-policies', () => hookMocks);

import { PolicySodEditor } from './policy-sod-editor';

function rule(overrides: Partial<PolicySodRule> = {}): PolicySodRule {
  return {
    id: 'sod-1',
    code: 'PO_APPROVER_NOT_CREATOR',
    description: 'The approver of a purchase order cannot be its creator.',
    isActive: true,
    ...overrides,
  };
}

function mutationState(over: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean; isError: boolean; error: unknown }> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PolicySodEditor', () => {
  it('adds a rule as active, upper-casing the code', async () => {
    hookMocks.useApprovalPolicySodRules.mockReturnValue({ data: [], isPending: false, isError: false });
    const state = mutationState();
    hookMocks.useUpsertApprovalPolicySodRule.mockReturnValue(state);
    renderWithProviders(<PolicySodEditor policyId="p1" editable />);

    await userEvent.type(screen.getByLabelText(/Code/), 'po_not_self_approve');
    await userEvent.type(
      screen.getByLabelText(/Description/),
      'A purchase order approver may not have created it.',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0]).toMatchObject({
      id: 'p1',
      code: 'PO_NOT_SELF_APPROVE',
      description: 'A purchase order approver may not have created it.',
      isActive: true,
    });
  });

  it('toggles an active rule off by re-sending the code with the flag flipped', async () => {
    hookMocks.useApprovalPolicySodRules.mockReturnValue({
      data: [rule({ isActive: true })],
      isPending: false,
      isError: false,
    });
    const state = mutationState();
    hookMocks.useUpsertApprovalPolicySodRule.mockReturnValue(state);
    renderWithProviders(<PolicySodEditor policyId="p1" editable />);

    await userEvent.click(screen.getByRole('button', { name: 'Deactivate' }));

    expect(state.mutate).toHaveBeenCalledWith({
      id: 'p1',
      code: 'PO_APPROVER_NOT_CREATOR',
      description: 'The approver of a purchase order cannot be its creator.',
      isActive: false,
    });
  });

  it('is read-only when not editable — no add form and no toggle', () => {
    hookMocks.useApprovalPolicySodRules.mockReturnValue({
      data: [rule()],
      isPending: false,
      isError: false,
    });
    hookMocks.useUpsertApprovalPolicySodRule.mockReturnValue(mutationState());
    renderWithProviders(<PolicySodEditor policyId="p1" editable={false} />);

    expect(screen.queryByLabelText(/Code/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.getByText('PO_APPROVER_NOT_CREATOR')).toBeInTheDocument();
  });

  it('surfaces a load failure', () => {
    hookMocks.useApprovalPolicySodRules.mockReturnValue({ data: undefined, isPending: false, isError: true });
    hookMocks.useUpsertApprovalPolicySodRule.mockReturnValue(mutationState());
    renderWithProviders(<PolicySodEditor policyId="p1" editable />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
