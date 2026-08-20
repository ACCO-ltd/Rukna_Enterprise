import { screen } from '@testing-library/react';
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
}));

vi.mock('../hooks/use-accounting', () => mocks);

import { BankAccounts } from './bank-accounts';

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
    renderWithProviders(<BankAccounts />, { permissions: ['manage:account'] });
    await user.click(screen.getByRole('button', { name: 'New Bank Account' }));
    return user;
  }

  /** A19 / #42 — the field the form must never grow back until the column exists. */

  it('offers only unmapped cash and bank GL accounts', async () => {
    await openForm();

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
