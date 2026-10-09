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
  glAccountCode: string;
  allowsReceipts: boolean;
  allowsPayments: boolean;
}

export function emptyBankAccountDraft(): BankAccountDraft {
  return {
    accountName: '',
    bankName: '',
    accountNumber: '',
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
  | 'glAccountCode'
  | 'no-direction';

export function bankAccountProblems(draft: BankAccountDraft): BankAccountProblem[] {
  const problems: BankAccountProblem[] = [];

  if (!draft.accountName.trim()) problems.push('accountName');
  if (!draft.bankName.trim()) problems.push('bankName');
  if (!draft.accountNumber.trim()) problems.push('accountNumber');
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
    // Single-currency platform (ADR-024): USD is implicit, never entered.
    currencyCode: 'USD',
    glAccountCode: draft.glAccountCode,
    allowsReceipts: draft.allowsReceipts,
    allowsPayments: draft.allowsPayments,
  };
}

/**
 * ─── Cash box / EVC float presets (ADR-045 P14) ───────────────────────────────────────
 *
 * Buyer cash (paying from the award) is handed out only from an account that has no signatories
 * — a buyer at the store cannot wait for two signatures. ACCO keeps its cash box (GL 10900 Petty
 * cash) and its EVC/Zaad float as ordinary bank-account rows. These presets fill the create form
 * so finance only checks and saves; the GL account is matched from the chart when one fits.
 */
export type CashAccountPreset = 'cash-box' | 'evc-float';

export function cashAccountPreset(
  preset: CashAccountPreset,
  names: { cashBoxName: string; evcName: string; evcProvider: string },
  accounts: readonly Account[],
  bankAccounts: readonly BankAccount[],
): BankAccountDraft {
  const candidates = mappableGlAccounts(accounts, bankAccounts);
  const named = (pattern: RegExp) =>
    candidates.find((account) => pattern.test(currentVersion(account)?.name ?? ''))?.code ?? '';
  if (preset === 'cash-box') {
    const gl = candidates.find((account) => account.code === '10900')?.code || named(/petty|cash box|cash on hand/i);
    return {
      ...emptyBankAccountDraft(),
      accountName: names.cashBoxName,
      bankName: names.cashBoxName,
      accountNumber: 'CASH-BOX',
      glAccountCode: gl,
    };
  }
  return {
    ...emptyBankAccountDraft(),
    accountName: names.evcName,
    bankName: names.evcProvider,
    // The float's merchant number when known; a readable placeholder otherwise (editable).
    accountNumber: 'EVC-FLOAT',
    glAccountCode: named(/evc|zaad|mobile money|float/i),
  };
}

export function isCashAccountPreset(value: string | null | undefined): value is CashAccountPreset {
  return value === 'cash-box' || value === 'evc-float';
}
