import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import { currentVersion } from './account-display';

import type { Account } from './types';

/**
 * ─── The opening balance migration ──────────────────────────────────────────────
 *
 * `POST /accounting/opening-balance` posts a `SYSTEM_OPENING` journal from a trial balance,
 * imports open AR invoices and AP bills, and returns a reconciliation report.
 *
 * **It runs once per organisation, ever.** The service guards on the existence of an
 * `EVT-OPB-001` journal and answers 409 with "Reverse it first to re-import". So this is not a
 * form somebody tries and refines — it is a cutover, and everything that can be checked before
 * the request should be.
 *
 * Three server failures are worth pre-empting, in descending order of how much they cost:
 *
 *  1. **Out of balance** → 400 naming both totals. The whole point of a trial balance is that
 *     it balances; discovering it does not, from a failed migration, is the wrong moment.
 *  2. **An account code not in the chart** → 404 naming *one* code, after which the
 *     transaction rolls back. A fifty-line trial balance with four unknown codes would take
 *     four attempts. Every unknown code is listed at once here.
 *  3. **A line whose amount is zero** → silently skipped (`if (amount.lte(0)) continue`). The
 *     row was typed, contributes nothing, and nothing says so.
 *
 * ─── Why paste, not fields ──────────────────────────────────────────────────────
 *
 * An accountant migrating onto this platform has a trial balance in the system they are
 * leaving. Fifty rows of paired inputs is transcription; a paste box is the format they
 * already have. The parser is deliberately forgiving about separators and thousands commas
 * and deliberately strict about everything else.
 */

export interface ParsedTrialBalanceLine {
  /** 1-based, for error messages that match what the user sees in their spreadsheet. */
  lineNumber: number;
  raw: string;
  accountCode: string;
  debitMinor: number;
  creditMinor: number;
}

export type ParseIssue =
  | { kind: 'malformed'; lineNumber: number; raw: string }
  | { kind: 'unparseable-amount'; lineNumber: number; raw: string }
  | { kind: 'both-sides'; lineNumber: number; accountCode: string }
  | { kind: 'negative'; lineNumber: number; accountCode: string };

export interface ParsedTrialBalance {
  lines: ParsedTrialBalanceLine[];
  issues: ParseIssue[];
}

/** Strips thousands separators and currency padding, then parses to minor units. */
function amount(token: string | undefined): number | null {
  const cleaned = (token ?? '').trim().replace(/,/g, '');
  if (cleaned === '' || cleaned === '-') return 0;
  return parseMinorUnits(cleaned, MONEY_SCALE);
}

/**
 * Picks one separator per row, in priority order.
 *
 * A comma is both a field separator and a thousands separator, so it is tried last: a row that
 * contains a tab or a run of spaces uses that instead, and `1,234,567.89` survives intact. Only
 * a row with neither falls back to commas, where thousands separators genuinely cannot be
 * distinguished from fields — that case is caught by the field count rather than mis-parsed.
 */
function splitRow(raw: string): string[] {
  const trimmed = raw.trim();

  const separator = trimmed.includes('\t')
    ? /\t/
    : /\s{2,}/.test(trimmed)
      ? /\s{2,}/
      : trimmed.includes(',')
        ? /\s*,\s*/
        : /\s+/;

  return trimmed
    .split(separator)
    .map((part) => part.trim())
    .filter((part) => part !== '');
}

/**
 * Parses pasted rows of `code, debit, credit`.
 *
 * Accepts tabs, commas or runs of spaces — a paste out of a spreadsheet is tab-separated, a
 * paste out of a CSV export is comma-separated, and someone retyping by hand uses spaces.
 * Blank lines are skipped rather than reported; a trailing newline is not a mistake worth a
 * message.
 */
export function parseTrialBalance(input: string): ParsedTrialBalance {
  const lines: ParsedTrialBalanceLine[] = [];
  const issues: ParseIssue[] = [];

  const rows = input.split(/\r?\n/);

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i]!;
    const lineNumber = i + 1;
    if (raw.trim() === '') continue;

    const parts = splitRow(raw);

    // Fewer than two fields is not a row. More than three means the separator was ambiguous —
    // in practice a comma-separated paste that also uses thousands separators, where
    // `10100,1,234.56,0` is indistinguishable from four fields. Reported rather than guessed:
    // taking the first three would read 1 as the debit and post a hundredth of the balance.
    if (parts.length < 2 || parts.length > 3) {
      issues.push({ kind: 'malformed', lineNumber, raw });
      continue;
    }

    const accountCode = parts[0]!.trim();
    const debitMinor = amount(parts[1]);
    const creditMinor = amount(parts[2]);

    if (debitMinor === null || creditMinor === null) {
      issues.push({ kind: 'unparseable-amount', lineNumber, raw });
      continue;
    }

    if (debitMinor < 0 || creditMinor < 0) {
      issues.push({ kind: 'negative', lineNumber, accountCode });
      continue;
    }

    // A trial balance line sits on one side. Both populated means the source was misread, and
    // the server would silently take the debit — `debitBalance ?? creditBalance`.
    if (debitMinor > 0 && creditMinor > 0) {
      issues.push({ kind: 'both-sides', lineNumber, accountCode });
      continue;
    }

    lines.push({ lineNumber, raw, accountCode, debitMinor, creditMinor });
  }

  return { lines, issues };
}

export interface TrialBalanceTotals {
  debitMinor: number;
  creditMinor: number;
  balanced: boolean;
  differenceMinor: number;
}

export function trialBalanceTotals(lines: readonly ParsedTrialBalanceLine[]): TrialBalanceTotals {
  const debitMinor = lines.reduce((sum, line) => sum + line.debitMinor, 0);
  const creditMinor = lines.reduce((sum, line) => sum + line.creditMinor, 0);

  return {
    debitMinor,
    creditMinor,
    balanced: debitMinor === creditMinor,
    differenceMinor: debitMinor - creditMinor,
  };
}

/** Codes in the paste that are not in the chart. The server 404s on the first one only. */
export function unknownAccountCodes(
  lines: readonly ParsedTrialBalanceLine[],
  accounts: readonly Account[],
): string[] {
  const known = new Set(accounts.map((account) => account.code));
  const missing = new Set<string>();

  for (const line of lines) {
    if (!known.has(line.accountCode)) missing.add(line.accountCode);
  }
  return [...missing].sort();
}

/**
 * Lines that will be silently dropped by the server.
 *
 * `if (amount.lte(0)) continue` — a row with nothing on either side posts nothing. Reported
 * because the row was typed on purpose, and because a trial balance that balances at zero on
 * both sides would otherwise submit happily and import an empty journal.
 */
export function zeroLines(
  lines: readonly ParsedTrialBalanceLine[],
): ParsedTrialBalanceLine[] {
  return lines.filter((line) => line.debitMinor === 0 && line.creditMinor === 0);
}

/** Accounts in the chart that carry a subtype the migration cares about, for the code pickers. */
export function accountsBySubtype(
  accounts: readonly Account[],
  subtype: string,
): Account[] {
  return accounts
    .filter(
      (account) =>
        account.status === 'ACTIVE' && currentVersion(account)?.accountSubtype === subtype,
    )
    .sort((a, b) => a.code.localeCompare(b.code));
}

export type MigrationBlocker =
  | 'no-lines'
  | 'parse-issues'
  | 'unknown-codes'
  | 'out-of-balance'
  | 'all-zero'
  | 'missing-header';

/**
 * Everything preventing the migration from running, worst first.
 *
 * Ordered so the message the user sees is the one that matters: a paste that will not parse is
 * a more immediate problem than one that does not balance, and both matter more than a header
 * field left empty.
 */
export function migrationBlockers(input: {
  lines: readonly ParsedTrialBalanceLine[];
  issues: readonly ParseIssue[];
  unknownCodes: readonly string[];
  totals: TrialBalanceTotals;
  cutoverDate: string;
  batchReference: string;
  arAccountCode: string;
  apAccountCode: string;
}): MigrationBlocker[] {
  const blockers: MigrationBlocker[] = [];

  if (input.lines.length === 0 && input.issues.length === 0) blockers.push('no-lines');
  if (input.issues.length > 0) blockers.push('parse-issues');
  if (input.unknownCodes.length > 0) blockers.push('unknown-codes');
  if (input.lines.length > 0 && !input.totals.balanced) blockers.push('out-of-balance');
  if (
    input.lines.length > 0 &&
    input.totals.debitMinor === 0 &&
    input.totals.creditMinor === 0
  ) {
    blockers.push('all-zero');
  }
  if (
    !input.cutoverDate ||
    !input.batchReference.trim() ||
    !input.arAccountCode ||
    !input.apAccountCode
  ) {
    blockers.push('missing-header');
  }

  return blockers;
}

export interface OpeningBalanceBody {
  cutoverDate: string;
  batchReference: string;
  arAccountCode: string;
  apAccountCode: string;
  trialBalance: { accountCode: string; debitBalance?: number; creditBalance?: number }[];
}

/**
 * Builds the request body.
 *
 * Only the populated side is sent per line. The DTO marks both optional and the service reads
 * `debitBalance ?? creditBalance`, so sending an explicit `0` on the other side is harmless but
 * misleading in a payload someone will read back during an audit.
 */
export function toOpeningBalanceBody(input: {
  lines: readonly ParsedTrialBalanceLine[];
  cutoverDate: string;
  batchReference: string;
  arAccountCode: string;
  apAccountCode: string;
}): OpeningBalanceBody {
  return {
    cutoverDate: input.cutoverDate,
    batchReference: input.batchReference.trim(),
    arAccountCode: input.arAccountCode,
    apAccountCode: input.apAccountCode,
    trialBalance: input.lines.map((line) =>
      line.debitMinor > 0
        ? {
            accountCode: line.accountCode,
            debitBalance: Number(fromMinorUnits(line.debitMinor, MONEY_SCALE)),
          }
        : {
            accountCode: line.accountCode,
            creditBalance: Number(fromMinorUnits(line.creditMinor, MONEY_SCALE)),
          },
    ),
  };
}
