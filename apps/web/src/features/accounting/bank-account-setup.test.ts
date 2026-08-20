import { describe, expect, it } from 'vitest';

import {
  bankAccountProblems,
  emptyBankAccountDraft,
  glAvailability,
  mappableGlAccounts,
  toConfigureBankAccountBody,
  type BankAccountDraft,
} from './bank-account-setup';
import type { Account, BankAccount } from './types';

function account(
  id: string,
  code: string,
  name: string,
  accountSubtype: string,
  status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
): Account {
  return {
    id,
    code,
    status,
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        accountClass: 'ASSET',
        accountSubtype,
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

function bankAccount(glAccountId: string): BankAccount {
  return {
    id: `bank-${glAccountId}`,
    glAccountId,
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
}

const CASH_A = account('gl-1', '10100', 'Salaam Bank', 'CASH_AND_BANK');
const CASH_B = account('gl-2', '10200', 'Dahabshiil Bank', 'CASH_AND_BANK');
const RECEIVABLE = account('gl-3', '11000', 'Accounts Receivable', 'ACCOUNTS_RECEIVABLE');

function draft(overrides: Partial<BankAccountDraft> = {}): BankAccountDraft {
  return {
    ...emptyBankAccountDraft(),
    accountName: 'Main Operating',
    bankName: 'Salaam Bank',
    accountNumber: '000123454821',
    currencyCode: 'USD',
    glAccountCode: '10100',
    ...overrides,
  };
}

describe('mappableGlAccounts', () => {
  /** `bank-account.service.ts:36` — 400 unless the subtype is CASH_AND_BANK. */
  it('offers only cash and bank accounts', () => {
    expect(mappableGlAccounts([CASH_A, RECEIVABLE], []).map((a) => a.code)).toEqual(['10100']);
  });

  /** `glAccountId` is @unique, so a mapped account answers 409. */
  it('excludes a GL account already mapped to a bank account', () => {
    expect(mappableGlAccounts([CASH_A, CASH_B], [bankAccount('gl-1')]).map((a) => a.code)).toEqual(
      ['10200'],
    );
  });

  it('excludes inactive accounts', () => {
    const retired = account('gl-4', '10900', 'Old Bank', 'CASH_AND_BANK', 'INACTIVE');

    expect(mappableGlAccounts([retired], [])).toEqual([]);
  });

  it('sorts by code so the picker is stable', () => {
    expect(mappableGlAccounts([CASH_B, CASH_A], []).map((a) => a.code)).toEqual([
      '10100',
      '10200',
    ]);
  });
});

describe('glAvailability', () => {
  it('is null when something can be mapped', () => {
    expect(glAvailability([CASH_A], [])).toBeNull();
  });

  /**
   * The two unavailable cases need different sentences: one needs an account adding to the
   * chart, the other means every bank is already configured and nothing is wrong.
   */
  it('distinguishes a chart with no cash account from one where all are mapped', () => {
    expect(glAvailability([RECEIVABLE], [])).toBe('none-in-chart');
    expect(glAvailability([CASH_A], [bankAccount('gl-1')])).toBe('all-mapped');
  });
});

describe('bankAccountProblems', () => {
  it('accepts a complete draft', () => {
    expect(bankAccountProblems(draft())).toEqual([]);
  });

  it('reports every missing field at once', () => {
    expect(bankAccountProblems(emptyBankAccountDraft())).toEqual([
      'accountName',
      'bankName',
      'accountNumber',
      'currencyCode',
      'glAccountCode',
    ]);
  });

  it('requires exactly three characters of currency', () => {
    expect(bankAccountProblems(draft({ currencyCode: 'US' }))).toEqual(['currencyCode']);
    expect(bankAccountProblems(draft({ currencyCode: 'USDD' }))).toEqual(['currencyCode']);
  });

  /**
   * Not a server rule — the DTO takes two independent booleans and accepts both false. But
   * every receipt and payment picker filters on these, so an account with neither is invisible
   * everywhere it could be used: configuration that silently does nothing.
   */
  it('refuses an account that can neither receive nor pay', () => {
    expect(
      bankAccountProblems(draft({ allowsReceipts: false, allowsPayments: false })),
    ).toEqual(['no-direction']);
  });

  it('accepts an account that does only one of the two', () => {
    expect(bankAccountProblems(draft({ allowsPayments: false }))).toEqual([]);
    expect(bankAccountProblems(draft({ allowsReceipts: false }))).toEqual([]);
  });
});

describe('toConfigureBankAccountBody', () => {
  it('returns null for an incomplete draft', () => {
    expect(toConfigureBankAccountBody(emptyBankAccountDraft())).toBeNull();
  });

  it('trims and upper-cases the currency', () => {
    const body = toConfigureBankAccountBody(draft({ currencyCode: ' usd ' }))!;

    expect(body.currencyCode).toBe('USD');
  });

  /**
   * A19 / #42. The DTO accepts `accountNameAr`, `BankAccount` has no such column, and the
   * repository spreads the DTO into Prisma — so a populated Arabic name fails the request
   * while an absent one succeeds. This body must never carry the field.
   */
  it('never sends accountNameAr, which would fail the request', () => {
    const body = toConfigureBankAccountBody(draft())!;

    expect(body).not.toHaveProperty('accountNameAr');
    expect(Object.keys(body).sort()).toEqual([
      'accountName',
      'accountNumber',
      'allowsPayments',
      'allowsReceipts',
      'bankName',
      'currencyCode',
      'glAccountCode',
    ]);
  });
});
