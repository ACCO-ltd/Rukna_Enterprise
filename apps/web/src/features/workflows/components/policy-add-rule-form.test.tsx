import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { renderWithProviders } from '@/test/render';
import { chooseOption } from '@/test/choose-option';

/**
 * The add-rule form.
 *
 * Two matrix constraints are enforced here rather than left to the server's 400: the transition is
 * pinned to the approved `from → to` for the chosen transaction, and the submit is blocked until the
 * band is coherent. The tests lock both, plus that a well-formed rule is submitted with the pinned
 * transition rather than a free-texted one.
 */

const policyMocks = vi.hoisted(() => ({ useAddApprovalPolicyRule: vi.fn() }));
const rolesMocks = vi.hoisted(() => ({ useRoles: vi.fn() }));
vi.mock('../hooks/use-approval-policies', () => policyMocks);
vi.mock('@/features/roles/hooks/use-roles', () => rolesMocks);

import { PolicyAddRuleForm } from './policy-add-rule-form';

function mutationState(over: Partial<{ mutate: ReturnType<typeof vi.fn>; isPending: boolean; isError: boolean; error: unknown }> = {}) {
  return { mutate: vi.fn(), isPending: false, isError: false, error: null, ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  rolesMocks.useRoles.mockReturnValue({
    data: [
      { id: 'role-1', name: 'PROCUREMENT_MANAGER' },
      { id: 'role-2', name: 'CFO' },
    ],
    isPending: false,
  });
});

describe('PolicyAddRuleForm', () => {
  it('submits a matrix-constrained rule with the pinned transition', async () => {
    const state = mutationState();
    policyMocks.useAddApprovalPolicyRule.mockReturnValue(state);
    renderWithProviders(<PolicyAddRuleForm policyId="p1" />);

    // Default transaction type is the first authorable one (Material request → DRAFT/SUBMITTED).
    await userEvent.type(screen.getByLabelText(/Rule key/), 'MR_DEFAULT');
    await chooseOption(userEvent.setup(), screen.getByLabelText(/Required role/), 'PROCUREMENT_MANAGER');
    await userEvent.click(screen.getByRole('button', { name: 'Add rule' }));

    expect(state.mutate).toHaveBeenCalledTimes(1);
    expect(state.mutate.mock.calls[0][0]).toMatchObject({
      id: 'p1',
      ruleKey: 'MR_DEFAULT',
      transactionType: 'MATERIAL_REQUEST',
      requiredRole: 'PROCUREMENT_MANAGER',
      // Pinned to the approved transition, never free-texted.
      fromState: 'DRAFT',
      toState: 'SUBMITTED',
    });
  });

  it('keeps submit disabled until a rule key and role are present', async () => {
    policyMocks.useAddApprovalPolicyRule.mockReturnValue(mutationState());
    renderWithProviders(<PolicyAddRuleForm policyId="p1" />);

    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();

    await userEvent.type(screen.getByLabelText(/Rule key/), 'MR_DEFAULT');
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();

    await chooseOption(userEvent.setup(), screen.getByLabelText(/Required role/), 'CFO');
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeEnabled();
  });

  it('validates the amount band and blocks submit when max is below min', async () => {
    const state = mutationState();
    policyMocks.useAddApprovalPolicyRule.mockReturnValue(state);
    renderWithProviders(<PolicyAddRuleForm policyId="p1" />);

    await userEvent.type(screen.getByLabelText(/Rule key/), 'MR_BAND');
    await chooseOption(userEvent.setup(), screen.getByLabelText(/Required role/), 'CFO');
    await userEvent.type(screen.getByLabelText('Minimum amount'), '10000');
    await userEvent.type(screen.getByLabelText('Maximum amount'), '500');

    expect(
      screen.getByText('Maximum must be greater than or equal to minimum.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add rule' })).toBeDisabled();
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
