import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

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

const mocks = vi.hoisted(() => ({ useCreateAccount: vi.fn() }));

vi.mock('../hooks/use-accounting', () => mocks);

import { CreateAccountForm } from './create-account-form';

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useCreateAccount.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  });
});

describe('CreateAccountForm', () => {
  it('shows every field the DTO requires, including the two §6.13 omits', () => {
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    expect(screen.getByLabelText('Account code')).toBeInTheDocument();
    expect(screen.getByLabelText('Account name')).toBeInTheDocument();
    expect(screen.getByLabelText('Class')).toBeInTheDocument();
    expect(screen.getByLabelText('Account subtype')).toBeInTheDocument();
    expect(screen.getByLabelText('Normal balance')).toBeInTheDocument();
    // A5 — the reference omits these two, so a body built from it 400s.
    expect(screen.getByLabelText('Posting policy')).toBeInTheDocument();
    expect(screen.getByLabelText('Effective from')).toBeInTheDocument();
  });

  it('offers all thirty subtypes, grouped, regardless of the class chosen', () => {
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    const subtype = screen.getByLabelText('Account subtype') as HTMLSelectElement;
    // 30 subtypes plus the placeholder.
    expect(subtype.options).toHaveLength(31);
    expect(screen.getByRole('option', { name: 'Accumulated depreciation' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Unapplied client receipts' })).toBeInTheDocument();
  });

  it('defaults the normal balance from the account class', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Class'), 'LIABILITY');

    expect((screen.getByLabelText('Normal balance') as HTMLSelectElement).value).toBe('CREDIT');
  });

  /**
   * Accumulated depreciation is an ASSET with a CREDIT balance and it is correct, so this
   * warns and stays submittable. Blocking would make a contra account impossible.
   */
  it('warns on a contra pairing without blocking it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Class'), 'ASSET');
    await user.selectOptions(screen.getByLabelText('Normal balance'), 'CREDIT');

    expect(screen.getByText(/opposite side/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeEnabled();
  });

  it('lists every missing required field at once rather than one at a time', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(screen.getByText('This account cannot be created yet')).toBeInTheDocument();
    expect(screen.getByText('Enter an account code.')).toBeInTheDocument();
    expect(screen.getByText('Choose the date this account takes effect.')).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  /** A6 — the third policy exists in the schema and the DTO rejects it. */
  it('offers only the two posting policies the API accepts, and says why', () => {
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    const policy = screen.getByLabelText('Posting policy') as HTMLSelectElement;
    expect(policy.options).toHaveLength(2);
    expect(screen.getByText(/does not accept it/i)).toBeInTheDocument();
  });

  it('asks which subledger a control account governs, only once it is one', async () => {
    const user = userEvent.setup();
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />);

    expect(screen.queryByLabelText('Controls which subledger')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('This is a control account'));

    expect(screen.getByLabelText('Controls which subledger')).toBeInTheDocument();
  });

  it('renders in Arabic without a missing translation key', () => {
    renderWithProviders(<CreateAccountForm onDone={vi.fn()} />, { locale: 'ar' });

    expect(screen.getByText('التصنيف الفرعي للحساب')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'مجمّع الإهلاك' })).toBeInTheDocument();
  });
});
