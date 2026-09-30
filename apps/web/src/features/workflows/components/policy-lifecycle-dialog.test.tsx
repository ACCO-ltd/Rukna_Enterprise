import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

/**
 * The lifecycle dialog is a FormDialog (ADR-039). Its form is `noValidate`, so the rules the
 * inputs used to enforce natively — a reason of three characters, and an effective date where the
 * transition needs one — keep the primary unavailable until met.
 */
const mocks = vi.hoisted(() => ({ mutate: vi.fn() }));
vi.mock('../hooks/use-approval-policies', () => ({
  useTransitionApprovalPolicy: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
}));

import { PolicyLifecycleDialog } from './policy-lifecycle-dialog';

beforeEach(() => vi.clearAllMocks());

describe('PolicyLifecycleDialog', () => {
  it('needs a reason before a transition can be submitted', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PolicyLifecycleDialog policyId="p1" action="retire" onOpenChange={vi.fn()} />,
    );

    const dialog = screen.getByRole('dialog');
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    expect(dialog).toBeInTheDocument();
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/reason/i), 'Superseded by v3');
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(mocks.mutate).toHaveBeenCalledWith(
      { id: 'p1', action: 'retire', reason: 'Superseded by v3', effectiveFrom: undefined },
      expect.any(Object),
    );
  });

  it('needs an effective date for a transition that schedules', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <PolicyLifecycleDialog policyId="p1" action="schedule" onOpenChange={vi.fn()} />,
    );

    await user.type(screen.getByLabelText(/reason/i), 'Quarterly review');
    const submit = screen.getAllByRole('button').find((b) => b.getAttribute('type') === 'submit')!;
    expect(submit).toBeDisabled();
  });
});
