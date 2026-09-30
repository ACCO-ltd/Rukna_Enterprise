import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Account } from '../types';

/**
 * Edit account runs in a FormDialog (ADR-039). Its dirty check compares the raw form with what
 * it opened with, so a cleared name or a typed reason — neither of which would make a request —
 * still asks before being discarded.
 */
const mocks = vi.hoisted(() => ({ useAccounts: vi.fn(), useUpdateAccount: vi.fn() }));
vi.mock('../hooks/use-accounting', () => mocks);

import { EditAccountForm } from './edit-account-form';

const ACCOUNT = {
  id: 'a1',
  code: '10100',
  status: 'ACTIVE',
  versions: [
    {
      id: 'a1-v1',
      versionNumber: 1,
      name: 'Salaam Bank',
      accountClass: 'ASSET',
      accountSubtype: 'CASH_AND_BANK',
      normalBalance: 'DEBIT',
      isPostingAllowed: true,
      isControlAccount: false,
      controlledSubledgerType: null,
      controlPostingPolicy: 'UNRESTRICTED',
      parentAccountId: null,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
    },
  ],
} as unknown as Account;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAccounts.mockReturnValue({ data: [ACCOUNT], isPending: false, isError: false });
  mocks.useUpdateAccount.mockReturnValue({ mutate: vi.fn(), isPending: false, error: null });
});

function renderForm() {
  const onDone = vi.fn();
  renderWithProviders(<EditAccountForm title="Edit Salaam Bank" account={ACCOUNT} onDone={onDone} />);
  return { onDone };
}

describe('EditAccountForm', () => {
  it('closes at once when nothing was touched', async () => {
    const user = userEvent.setup();
    const { onDone } = renderForm();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onDone).toHaveBeenCalled();
  });

  it('asks before discarding a cleared name', async () => {
    const user = userEvent.setup();
    const { onDone } = renderForm();
    await user.clear(screen.getByLabelText(/Account name/));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('asks before discarding a typed reason', async () => {
    const user = userEvent.setup();
    const { onDone } = renderForm();
    await user.type(screen.getByLabelText(/reason/i), 'Typo');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('dialog', { name: 'Discard unsaved changes?' })).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});
