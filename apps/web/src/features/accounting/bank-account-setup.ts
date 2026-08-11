import { currentVersion } from './account-display';

import type { Account, BankAccount } from './types';

/**
 * ─── Configuring a bank account ─────────────────────────────────────────────────
 *
 * `POST /bank-accounts` is better guarded than most of this API. `bank-account.service.ts`
 * checks three things before it writes:
 *
 *   1. the GL code resolves to an account          → 404
 *   2. its current version is subtype CASH_AND_BANK → 400
 *   3. no bank account already maps to it           → 409
 *
 * All three are properties of the chart, which the form already holds, so the picker offers
 * only accounts that pass all three rather than letting the user find out by request. Unlike
 * most of the guards mirrored elsewhere in this codebase, these exist on the server too — the
 * filter is a convenience here, not a substitute.
 *
 * ─── One field is missing on purpose ────────────────────────────────────────────
 *
 * `ConfigureBankAccountDto` accepts `accountNameAr`, `BankAccount` has no such column, and the
 * repository spreads the DTO into Prisma — so supplying it fails the request while omitting it
 * succeeds (A19 / #42). The form does not offer an Arabic name until that is fixed.
 */

/**
 * The GL accounts a new bank account may be mapped to.
 *
 * `glAccountId` is `@unique` on `BankAccount`, so the mapping is strictly one-to-one and an
 * account already spoken for must not be offered — that is the 409.
 */
export function mappableGlAccounts(
  accounts: readonly Account[],
  bankAccounts: readonly BankAccount[],
): Account[] {
  const mapped = new Set(bankAccounts.map((bank) => bank.glAccountId));

  return accounts
    .filter(
      (account) =>
        account.status === 'ACTIVE' &&
        currentVersion(account)?.accountSubtype === 'CASH_AND_BANK' &&
        !mapped.has(account.id),
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

/**
 * Why no GL account can be chosen, or null when one can.
 *
 * The two cases need different sentences: a chart with no cash account needs one adding, while
 * a chart whose cash accounts are all mapped needs nothing — every bank is already configured.
 */
export type GlAvailability = 'none-in-chart' | 'all-mapped' | null;

export function glAvailability(
  accounts: readonly Account[],
  bankAccounts: readonly BankAccount[],
): GlAvailability {
  if (mappableGlAccounts(accounts, bankAccounts).length > 0) return null;

  const anyCash = accounts.some(
    (account) =>
      account.status === 'ACTIVE' && currentVersion(account)?.accountSubtype === 'CASH_AND_BANK',
  );
  return anyCash ? 'all-mapped' : 'none-in-chart';
}

export interface BankAccountDraft {
  accountName: string;
  bankName: string;
  accountNumber: string;
  currencyCode: string;
  glAccountCode: string;
  allowsReceipts: boolean;
  allowsPayments: boolean;
}

export function emptyBankAccountDraft(): BankAccountDraft {
  return {
    accountName: '',
    bankName: '',
    accountNumber: '',
    currencyCode: '',
    glAccountCode: '',
    // Both default on: a bank account that can neither receive nor pay is configuration with
    // no purpose, and the seeded accounts allow both.
    allowsReceipts: true,
    allowsPayments: true,
  };
}

export type BankAccountProblem =
  | 'accountName'
  | 'bankName'
  | 'accountNumber'
  | 'currencyCode'
  | 'glAccountCode'
  | 'no-direction';

export function bankAccountProblems(draft: BankAccountDraft): BankAccountProblem[] {
  const problems: BankAccountProblem[] = [];

  if (!draft.accountName.trim()) problems.push('accountName');
  if (!draft.bankName.trim()) problems.push('bankName');
  if (!draft.accountNumber.trim()) problems.push('accountNumber');
  if (draft.currencyCode.trim().length !== 3) problems.push('currencyCode');
  if (!draft.glAccountCode) problems.push('glAccountCode');

  /**
   * Not a server rule — the DTO takes two independent booleans and accepts both false. But
   * `payableBankAccounts` filters payment pickers on `allowsPayments`, and the receipt side
   * will filter on `allowsReceipts`, so an account with neither is invisible everywhere it
   * could be used. That is a configuration mistake worth catching at the point of making it.
   */
  if (!draft.allowsReceipts && !draft.allowsPayments) problems.push('no-direction');

  return problems;
}

/**
 * The request body.
 *
 * `accountNameAr` is deliberately absent — see A19 / #42. Nothing here may add it back until
 * the column exists, because sending it fails the whole request.
 */
export interface ConfigureBankAccountBody {
  accountName: string;
  bankName: string;
  accountNumber: string;
  currencyCode: string;
  glAccountCode: string;
  allowsReceipts: boolean;
  allowsPayments: boolean;
}

export function toConfigureBankAccountBody(
  draft: BankAccountDraft,
): ConfigureBankAccountBody | null {
  if (bankAccountProblems(draft).length > 0) return null;

  return {
    accountName: draft.accountName.trim(),
    bankName: draft.bankName.trim(),
    accountNumber: draft.accountNumber.trim(),
    currencyCode: draft.currencyCode.trim().toUpperCase(),
    glAccountCode: draft.glAccountCode,
    allowsReceipts: draft.allowsReceipts,
    allowsPayments: draft.allowsPayments,
  };
}
