import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';
import { chooseOption, openSelect } from '@/test/choose-option';

/**
 * The create-account form (tenant bootstrap, tier 1).
 *
 * Rendering against the real catalogues proves all thirty subtype labels plus the six group
 * headings exist in both locales — that is most of what this screen adds.
 *
 * The behavioural assertions pin the three decisions in `coa-setup.ts`: the normal balance is
 * defaulted from the class, a contra pairing warns without blocking, and the subtype list is
 * not filtered by class.
 */

const mocks = vi.hoisted(() => ({ useCreateAccount: vi.fn(), useAccounts: vi.fn() }));

vi.mock('../hooks/use-accounting', () => mocks);

import { CreateAccountForm } from './create-account-form';
import type { Account } from '../types';

function account(code: string, name: string, overrides: Partial<Account['versions'][number]> = {}): Account {
  return {
    id: `acc-${code}`,
    organizationId: 'org-1',
    code,
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [
      {
        id: `ver-${code}`,
        accountId: `acc-${code}`,
        versionNumber: 1,
        name,
        parentAccountId: null,
        accountClass: 'COST_OF_SALES',
        accountSubtype: 'MATERIAL_COST',
        isPostingAllowed: false,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
        ...overrides,
      },
    ],
  };
}

const CHART = [
  account('51000', 'Materials'),
  account('51100', 'Cement and concrete', { parentAccountId: 'acc-51000', isPostingAllowed: true }),
];

/** Normal balance, posting policy and the control-account flags live behind this toggle. */
async function openAdvanced(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Advanced/ }));
}

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateAccount.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useAccounts.mockReturnValue({ data: CHART, isPending: false });
});

describe('CreateAccountForm', () => {
  it('shows every field the DTO requires, including the two §6.13 omits', () => {
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    expect(screen.getByLabelText('Account code')).toBeInTheDocument();
    expect(screen.getByLabelText('Account name')).toBeInTheDocument();
    expect(screen.getByLabelText('Class')).toBeInTheDocument();
    expect(screen.getByLabelText('Account subtype')).toBeInTheDocument();
    expect(screen.getByLabelText('Normal balance')).toBeInTheDocument();
    // A5 — the reference omits these two, so a body built from it 400s.
    expect(screen.getByLabelText('Posting policy')).toBeInTheDocument();
    expect(screen.getByLabelText('Effective from')).toBeInTheDocument();
  });

  it('offers all thirty subtypes, grouped, regardless of the class chosen', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    // The list only exists while the select is open — that is what makes it stylable.
    await openSelect(user, screen.getByLabelText('Account subtype'));
    // 30 subtypes plus the placeholder.
    expect(screen.getAllByRole('option')).toHaveLength(31);
    expect(screen.getByRole('option', { name: 'Accumulated depreciation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unapplied client receipts' })).toBeInTheDocument();
  });

  it('defaults the normal balance from the account class', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    await chooseOption(user, screen.getByLabelText('Class'), 'LIABILITY');
    await openAdvanced(user);

    // The control is a trigger now, so the chosen value is what it displays.
    expect(screen.getByLabelText('Normal balance')).toHaveTextContent('Credit');
  });

  /**
   * Accumulated depreciation is an ASSET with a CREDIT balance and it is correct, so this
   * warns and stays submittable. Blocking would make a contra account impossible.
   */
  it('warns on a contra pairing without blocking it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    await chooseOption(user, screen.getByLabelText('Class'), 'ASSET');
    await openAdvanced(user);
    await chooseOption(user, screen.getByLabelText('Normal balance'), 'CREDIT');

    expect(screen.getByText(/opposite side/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('lists every missing required field at once rather than one at a time', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('This account cannot be created yet')).toBeInTheDocument();
    expect(screen.getByText('Enter an account code.')).toBeInTheDocument();
    expect(screen.getByText('Choose the date this account takes effect.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  /** A6 — the third policy exists in the schema and the DTO rejects it. */
  it('offers only the two posting policies the API accepts, and says why', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    await openAdvanced(user);
    await openSelect(user, screen.getByLabelText('Posting policy'));
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByText(/does not accept it/i)).toBeInTheDocument();
  });

  it('asks which subledger a control account governs, only once it is one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    expect(screen.queryByLabelText('Controls which subledger')).not.toBeInTheDocument();

    await openAdvanced(user);
    await user.click(screen.getByRole('switch', { name: 'This is a control account' }));

    expect(screen.getByLabelText('Controls which subledger')).toBeInTheDocument();
  });

  it('keeps the rarely changed fields folded under Advanced', () => {
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByLabelText('Normal balance')).not.toBeVisible();
    expect(screen.getByLabelText('Account name')).toBeVisible();
  });

  it('opens Advanced by itself when an answer inside it is missing', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByRole('button', { name: /Advanced/ })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Normal balance')).toBeVisible();
  });

  it('asks for a parent from the chart, and fills class, subtype and the next free code from it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    expect(screen.queryByRole('combobox', { name: 'Parent account' })).not.toBeInTheDocument();
    await user.click(screen.getByLabelText('Make this a sub-account'));
    await user.click(screen.getByRole('combobox', { name: 'Parent account' }));
    await user.click(await screen.findByRole('option', { name: /51000 · Materials/ }));

    expect(screen.getByLabelText('Class')).toHaveTextContent('Cost of Sales');
    expect(screen.getByLabelText('Account subtype')).toHaveTextContent('Material cost');
    expect(screen.getByLabelText('Account code')).toHaveValue('51200');
  });

  it('never overwrites what the user already chose when a parent is picked', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    await user.type(screen.getByLabelText('Account code'), '51150');
    await chooseOption(user, screen.getByLabelText('Class'), 'EXPENSE');
    await user.click(screen.getByLabelText('Make this a sub-account'));
    await user.click(screen.getByRole('combobox', { name: 'Parent account' }));
    await user.click(await screen.findByRole('option', { name: /51000 · Materials/ }));

    expect(screen.getByLabelText('Account code')).toHaveValue('51150');
    expect(screen.getByLabelText('Class')).toHaveTextContent('Expense');
  });

  it('offers Reset once something is typed, and it clears the form', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm title="New account" onDone={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Account name'), 'Paint');
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByLabelText('Account name')).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Reset' })).not.toBeInTheDocument();
  });
});
