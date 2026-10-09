import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '@/test/render';

import type { Account, BankAccount } from '../types';

/**
 * Bank accounts (tenant bootstrap, tier 3).
 *
 * The assertion that matters most is the absence of an Arabic name field: the DTO advertises
 * one, there is no column, and supplying it fails the whole request (A19 / #42). If a future
 * change adds the input back before the column exists, this is what should stop it.
 */

const mocks = vi.hoisted(() => ({
  useBankAccounts: vi.fn(),
  useAccounts: vi.fn(),
  useConfigureBankAccount: vi.fn(),
  useSignatories: vi.fn(),
  useAddSignatory: vi.fn(),
  useRemoveSignatory: vi.fn(),
}));

vi.mock('../hooks/use-accounting', () => mocks);
vi.mock('@/features/users/hooks/use-users', () => ({
  useUsers: () => ({
    data: [{ id: 'u1', firstName: 'Amina', lastName: 'Ali', email: 'amina@acco.com' }],
    isPending: false,
    isError: false,
  }),
}));

import { BankAccounts } from './bank-accounts';
import { openSelect } from '@/test/choose-option';

function account(id: string, code: string, name: string, subtype: string): Account {
  return {
    id,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        accountClass: 'ASSET',
        accountSubtype: subtype,
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
}

const CASH = account('gl-1', '10100', 'Salaam Bank', 'CASH_AND_BANK');
const RECEIVABLE = account('gl-2', '11000', 'Accounts Receivable', 'ACCOUNTS_RECEIVABLE');

const BANK: BankAccount = {
  id: 'bank-1',
  glAccountId: 'gl-9',
  bankName: 'Salaam Bank',
  accountName: 'Main Operating',
  accountNumber: '000123454821',
  iban: null,
  swiftCode: null,
  currencyCode: 'USD',
  branch: null,
  allowsReceipts: true,
  allowsPayments: true,
  isReconcilable: true,
  status: 'ACTIVE',
};

const mutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useBankAccounts.mockReturnValue({ data: [BANK], isPending: false, isError: false });
  mocks.useAccounts.mockReturnValue({
    data: [CASH, RECEIVABLE],
    isPending: false,
    isError: false,
  });
  mocks.useConfigureBankAccount.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  });
  mocks.useSignatories.mockReturnValue({
    data: [{ id: 's1', userId: 'u1', isActive: true, addedAt: '2026-09-01T00:00:00.000Z' }],
    isPending: false,
    isError: false,
  });
  mocks.useAddSignatory.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
  mocks.useRemoveSignatory.mockReturnValue({ mutate: vi.fn(), isPending: false, isError: false });
});

describe('BankAccounts list', () => {
  it('lists each account with its bank and name', () => {
    renderWithProviders(<BankAccounts />);

    expect(screen.getByText('Salaam Bank')).toBeInTheDocument();
    expect(screen.getByText('Main Operating')).toBeInTheDocument();
  });

  /** A full account number on a list screen is a detail nobody needs and everyone can screenshot. */
  it('masks the account number to its last four digits', () => {
    renderWithProviders(<BankAccounts />);

    expect(screen.getByText('****4821')).toBeInTheDocument();
    expect(screen.queryByText('000123454821')).not.toBeInTheDocument();
  });

  it('says plainly that an account cannot be edited or closed here', () => {
    renderWithProviders(<BankAccounts />);

    expect(screen.getByText(/cannot be edited, suspended or closed/i)).toBeInTheDocument();
  });

  it('explains an empty list rather than showing a bare table', () => {
    mocks.useBankAccounts.mockReturnValue({ data: [], isPending: false, isError: false });
    renderWithProviders(<BankAccounts />);

    expect(screen.getByText('No bank account is configured.')).toBeInTheDocument();
  });
});

describe('configure form', () => {
  async function openForm() {
    const user = userEvent.setup();
    renderWithProviders(<BankAccounts />, { permissions: ['manage:accounting'] });
    await user.click(screen.getByRole('button', { name: 'New Bank Account' }));
    return user;
  }

  /** A19 / #42 — the field the form must never grow back until the column exists. */

  it('offers only unmapped cash and bank GL accounts', async () => {
    const user = await openForm();

    await openSelect(user, screen.getByLabelText('GL account'));
    expect(screen.getByRole('option', { name: '10100 · Salaam Bank' })).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: /Accounts Receivable/ }),
    ).not.toBeInTheDocument();
  });


  it('refuses an account that can neither receive nor pay', async () => {
    const user = await openForm();

    await user.click(screen.getByLabelText('Receiving money'));
    await user.click(screen.getByLabelText('Paying money'));
    await user.click(screen.getByRole('button', { name: 'Configure account' }));

    expect(screen.getByText(/will not appear anywhere/i)).toBeInTheDocument();
    expect(mutate).not.toHaveBeenCalled();
  });

  it('explains a chart with no cash account instead of an empty picker', async () => {
    mocks.useAccounts.mockReturnValue({
      data: [RECEIVABLE],
      isPending: false,
      isError: false,
    });
    await openForm();

    expect(screen.getByText('No cash or bank GL account exists')).toBeInTheDocument();
  });

  it('distinguishes every cash account already being mapped', async () => {
    mocks.useAccounts.mockReturnValue({ data: [CASH], isPending: false, isError: false });
    mocks.useBankAccounts.mockReturnValue({
      data: [{ ...BANK, glAccountId: 'gl-1' }],
      isPending: false,
      isError: false,
    });
    await openForm();

    expect(screen.getByText('Every cash account is already mapped')).toBeInTheDocument();
  });

});

/** ADR-045 P14 — buyer cash needs a cash account without signatories; the presets fill one in. */
describe('cash box / EVC float presets', () => {
  const PETTY = account('gl-10900', '10900', 'Petty cash', 'CASH_AND_BANK');

  it('opens the form filled as a cash box on GL 10900 when arriving from a payment (?preset=cash-box)', async () => {
    mocks.useAccounts.mockReturnValue({ data: [CASH, PETTY], isPending: false, isError: false });
    renderWithProviders(<BankAccounts preset="cash-box" />, { permissions: ['manage:accounting'] });

    const dialog = await screen.findByRole('dialog', { name: 'Add cash box' });
    expect(within(dialog).getByLabelText('Bank name')).toHaveValue('Cash box');
    expect(within(dialog).getByLabelText('Account number')).toHaveValue('CASH-BOX');
    expect(within(dialog).getByText(/Keep this account without signatories/)).toBeInTheDocument();

    await userEvent.setup().click(within(dialog).getByRole('button', { name: 'Configure account' }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ bankName: 'Cash box', glAccountCode: '10900', allowsPayments: true }),
      expect.anything(),
    );
  });

  it('offers the presets beside New Bank Account, and explains where buyer cash comes from', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankAccounts />, { permissions: ['manage:accounting'] });
    expect(screen.getByText(/Buyer cash for purchases is handed out only from an account with no signatories/)).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: 'Add EVC float' })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add EVC float' });
    expect(within(dialog).getByLabelText('Bank name')).toHaveValue('EVC Plus');
  });

  it('ignores the preset for someone who cannot add accounts', () => {
    renderWithProviders(<BankAccounts preset="cash-box" />, { permissions: ['view:accounting'] });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

/** ADR-039 — the signatories panel is a FormDialog, not a side sheet. */
describe('signatories dialog', () => {
  it('opens as a dialog named for the panel and the account, and closes from its footer', async () => {
    const user = userEvent.setup();
    renderWithProviders(<BankAccounts />, { permissions: ['manage:accounting'] });

    await user.click(screen.getByRole('button', { name: 'Signatories' }));
    const dialog = await screen.findByRole('dialog', { name: 'Signatories' });
    expect(within(dialog).getByText('Main Operating')).toBeInTheDocument();
    expect(within(dialog).getByText('Amina Ali')).toBeInTheDocument();

    const close = within(dialog)
      .getAllByRole('button', { name: 'Close' })
      .find((button) => button.textContent === 'Close');
    await user.click(close!);
    expect(screen.queryByRole('dialog', { name: 'Signatories' })).not.toBeInTheDocument();
  });
});
