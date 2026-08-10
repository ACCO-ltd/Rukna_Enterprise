import { currentVersion } from './account-display';

import type { Account } from './types';

/**
 * ─── Which GL account plays which role ──────────────────────────────────────────
 *
 * Every AR and AP endpoint that touches the ledger takes raw account CODES in its request
 * body: `POST /invoices/:id/post` wants `arAccountCode` and `revenueAccountCode`,
 * `POST /customer-receipts/:id/post` wants three more, and so on down the AP side.
 *
 * That is the server asking the browser which account is Accounts Receivable. An accountant
 * pressing Post should not be answering that question — picking the wrong control account
 * puts a debit somewhere no report will look for it, and nothing downstream objects.
 *
 * `PostingProfile` is the entity that should answer it server-side. `GET /posting-profiles`
 * now exists, but it maps a profile code to the EXPENSE account a supplier bill line posts to
 * (`PostingProfileVersion.accountId`); it says nothing about the AR control account, the VAT
 * account or the bank. So control accounts are resolved here, from the chart of accounts, by
 * the one field that states an account's role: `AccountVersion.accountSubtype`.
 *
 * ─── Why this refuses rather than guesses ───────────────────────────────────────
 *
 * A subtype is unique in the seeded chart, and nothing enforces that. An organisation can
 * open a second account marked ACCOUNTS_RECEIVABLE tomorrow, and then "the AR account" is a
 * question with two answers.
 *
 * Taking the first match would post real money to whichever row the query happened to return
 * first, and the trial balance would still balance — the error is invisible in every report
 * that exists. So an ambiguous or missing role is returned as a failure the screen must
 * render, and posting stays blocked until an administrator resolves it.
 *
 * Delete this module when a posting profile can resolve control accounts server-side; at that
 * point the codes come off the request bodies entirely.
 */

/** A role a posting endpoint needs filled, named for what it does rather than its code. */
export type PostingRole =
  | 'AR_CONTROL'
  | 'REVENUE'
  | 'VAT_OUTPUT'
  | 'UNAPPLIED_RECEIPTS'
  | 'AP_CONTROL'
  | 'SUPPLIER_ADVANCE';

/**
 * The `AccountSubtype` value that marks each role.
 *
 * These are the enum members in `schema.prisma`, not display names — they arrive on
 * `AccountVersion.accountSubtype` exactly as spelled here.
 */
const SUBTYPE_FOR: Record<PostingRole, string> = {
  AR_CONTROL: 'ACCOUNTS_RECEIVABLE',
  REVENUE: 'PROJECT_REVENUE',
  VAT_OUTPUT: 'VAT_OUTPUT_PAYABLE',
  UNAPPLIED_RECEIPTS: 'UNAPPLIED_CLIENT_RECEIPTS',
  AP_CONTROL: 'ACCOUNTS_PAYABLE',
  SUPPLIER_ADVANCE: 'SUPPLIER_ADVANCE',
};

/**
 * `NOT_CONFIGURED` — no ACTIVE account carries the subtype. The chart is incomplete.
 * `AMBIGUOUS` — more than one does. The chart is contradictory.
 *
 * Both are administrator problems, and the message shown to the user has to say which,
 * because the fix is different: add an account, or correct one.
 */
export type ResolutionProblem = 'NOT_CONFIGURED' | 'AMBIGUOUS';

export type Resolution =
  | { ok: true; role: PostingRole; account: Account; code: string }
  | { ok: false; role: PostingRole; problem: ResolutionProblem; candidates: Account[] };

/** ACTIVE accounts whose current version carries `subtype`. */
function matching(accounts: readonly Account[], subtype: string): Account[] {
  return accounts.filter(
    (account) =>
      account.status === 'ACTIVE' && currentVersion(account)?.accountSubtype === subtype,
  );
}

/**
 * Finds the one account that fills `role`.
 *
 * Reads `currentVersion`, not `versionEffectiveOn`: a role is a property of how the chart is
 * configured now, and the posting date does not change which account is the AR control.
 */
export function resolvePostingAccount(
  accounts: readonly Account[],
  role: PostingRole,
): Resolution {
  const candidates = matching(accounts, SUBTYPE_FOR[role]);

  if (candidates.length === 0) {
    return { ok: false, role, problem: 'NOT_CONFIGURED', candidates: [] };
  }
  if (candidates.length > 1) {
    return { ok: false, role, problem: 'AMBIGUOUS', candidates };
  }

  const account = candidates[0]!;
  return { ok: true, role, account, code: account.code };
}

/**
 * Resolves several roles at once, keeping every failure rather than stopping at the first.
 *
 * A chart missing both its VAT account and its revenue account should say so once, not make
 * the user fix one, press Post again, and meet the next.
 */
export function resolvePostingAccounts(
  accounts: readonly Account[],
  roles: readonly PostingRole[],
): { resolved: Map<PostingRole, Account>; problems: Extract<Resolution, { ok: false }>[] } {
  const resolved = new Map<PostingRole, Account>();
  const problems: Extract<Resolution, { ok: false }>[] = [];

  for (const role of roles) {
    const result = resolvePostingAccount(accounts, role);
    if (result.ok) resolved.set(role, result.account);
    else problems.push(result);
  }

  return { resolved, problems };
}

/**
 * The bank accounts a receipt or payment may move money through.
 *
 * Unlike every other role this one is legitimately plural — the seeded chart has two, and an
 * organisation with five banks has five. The user picks; the resolver does not.
 *
 * Sorted by code so the list order is stable between renders and between users.
 */
export function bankAccounts(accounts: readonly Account[]): Account[] {
  return matching(accounts, 'CASH_AND_BANK').sort((a, b) => a.code.localeCompare(b.code));
}
