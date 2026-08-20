import type { Account, AccountVersion } from './types';

/**
 * ─── Resolving what an account is called ────────────────────────────────────────
 *
 * `Account` carries a code and a normal balance. Everything a person reads — the name, the
 * class, the parent, whether posting is allowed — is on `AccountVersion`, because all of those
 * can change and each change has to stay auditable against the entries posted under it.
 *
 * So no screen can render an account without picking a version, and there are two different
 * right answers depending on the question being asked. Getting them confused is silent: both
 * return a plausible name.
 */

/**
 * The version in force on a given date.
 *
 * `[effectiveFrom, effectiveTo)` — `effectiveTo` is EXCLUSIVE, per the schema comment on
 * `AccountVersion`. Use this when the answer must match what the ledger saw: resolving the
 * account on a journal line dated last March means last March's name, not today's.
 *
 * Returns `null` when no version covers the date, which is a real state — an account created
 * this year has no version effective for last year's entries.
 */
export function versionEffectiveOn(
  account: Account,
  isoDate: string,
): AccountVersion | null {
  const date = isoDate.slice(0, 10);

  const covering = account.versions.filter((v) => {
    const from = v.effectiveFrom.slice(0, 10);
    const to = v.effectiveTo?.slice(0, 10) ?? null;
    return from <= date && (to === null || date < to);
  });

  if (covering.length === 0) return null;

  // Ranges should not overlap — a raw-SQL exclusion constraint enforces it — but if one ever
  // does, the later version is the one to show rather than whichever the array happened to
  // hold first.
  return covering.reduce((latest, v) => (v.versionNumber > latest.versionNumber ? v : latest));
}

/**
 * The most recently recorded version, whatever its effective date.
 *
 * This is what `GET /accounts` returns — `take: 1` ordered by `versionNumber` descending — so
 * it is what a chart-of-accounts browser is looking at. Note it may be future-dated: a rename
 * scheduled for next quarter is already the latest version today.
 *
 * For anything tied to a transaction date, use `versionEffectiveOn` instead.
 */
export function currentVersion(account: Account): AccountVersion | null {
  if (account.versions.length === 0) return null;

  return account.versions.reduce((latest, v) =>
    v.versionNumber > latest.versionNumber ? v : latest,
  );
}

/**
 * The account's name, falling back to the code. The trailing parameter is retained for call-site
 * compatibility since the system went English-only; it is ignored.
 */
export function accountName(account: Account, _locale?: string): string {
  const version = currentVersion(account);
  if (!version) return account.code;

  return version.name || account.code;
}

/** `"10100 — Salaam Bank"`. The code first, because that is how accountants refer to them. */
export function accountLabel(account: Account, locale: 'en' | 'ar'): string {
  const name = accountName(account, locale);
  return name === account.code ? account.code : `${account.code} — ${name}`;
}

/**
 * What to show for a journal line's account.
 *
 * A POSTED line carries `accountCodeSnapshot` and `accountNameSnapshot`, frozen at the moment
 * it was posted — that is the correct thing to display, and it stays correct after the account
 * is renamed.
 *
 * A DRAFT line carries EMPTY STRINGS for both (`manual-journal.service.ts:91-93`), because the
 * snapshots are only resolved by the posting engine. So a draft has to be looked up live, and
 * a draft whose account has since been deleted has nothing to fall back on but the id.
 */
export function lineAccountLabel(
  line: { accountId: string; accountCodeSnapshot: string; accountNameSnapshot: string },
  accountsById: ReadonlyMap<string, Account>,
  locale: 'en' | 'ar',
): string {
  if (line.accountCodeSnapshot) {
    return line.accountNameSnapshot
      ? `${line.accountCodeSnapshot} — ${line.accountNameSnapshot}`
      : line.accountCodeSnapshot;
  }

  const account = accountsById.get(line.accountId);
  if (account) return accountLabel(account, locale);

  // Neither a snapshot nor a live account. Showing the tail of the id at least distinguishes
  // two rows; showing nothing would read as an empty line.
  return line.accountId.slice(-8);
}

/** Indexes accounts by id for the line-label lookup above. */
export function indexAccounts(accounts: readonly Account[]): Map<string, Account> {
  return new Map(accounts.map((a) => [a.id, a]));
}

/**
 * Accounts a manual journal may post to.
 *
 * A control account is written only by the posting engine — the AR and AP control accounts
 * are `SYSTEM_ONLY`, and offering them in a journal editor invites an entry the server will
 * reject at posting, after approval, when it is most expensive to discover.
 *
 * `SYSTEM_OR_APPROVED_ADJUSTMENT` accounts (the banks) are included: an approved manual
 * adjustment is exactly what a CFO-approved journal is.
 */
export function postableAccounts(accounts: readonly Account[]): Account[] {
  return accounts.filter((account) => {
    if (account.status !== 'ACTIVE') return false;

    const version = currentVersion(account);
    if (!version) return false;

    return version.isPostingAllowed && version.controlPostingPolicy !== 'SYSTEM_ONLY';
  });
}

/** Case-insensitive match on code or name, in either locale. */
export function accountMatches(account: Account, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;

  const version = currentVersion(account);

  return [account.code, version?.name, version?.accountSubtype]
    .filter((v): v is string => typeof v === 'string' && v.length > 0)
    .some((v) => v.toLowerCase().includes(needle));
}
