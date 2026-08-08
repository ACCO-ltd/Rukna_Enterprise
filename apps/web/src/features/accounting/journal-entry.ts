import { MONEY_SCALE, fromMinorUnits, parseMinorUnits } from '@/lib/money';

import type { CreateJournalPayload, JournalEntry, JournalStatus } from './types';

/**
 * ─── The rules a journal has to satisfy ─────────────────────────────────────────
 *
 * `DoubleEntryValidator` (`accounting-core/application/validators/double-entry.validator.ts`)
 * enforces exactly three things, and it runs at POST time — not at create, not at submit:
 *
 *   1. at least two lines
 *   2. every line carries a debit or a credit, and never both
 *   3. ∑ debits = ∑ credits
 *
 * Posting is the last step of a four-step lifecycle. A journal that breaks any of these can be
 * saved, submitted, and approved by a CFO before anything objects — and the rejection then
 * lands on whoever pressed Post, about an entry someone else wrote. So the editor mirrors all
 * three and refuses to save a journal the server would eventually reject.
 *
 * The arithmetic runs in integer minor units. Summing a column of decimal strings with
 * `Number` is how a journal ends up out of balance by a cent that nobody can find.
 */

/** A line as the editor holds it: strings, because that is what the inputs contain. */
export interface JournalLineDraft {
  accountId: string;
  debit: string;
  credit: string;
  memo: string;
}

export interface JournalDraft {
  accountingDate: string;
  documentDate: string;
  description: string;
  currencyCode: string;
  lines: JournalLineDraft[];
}

export function emptyLine(): JournalLineDraft {
  return { accountId: '', debit: '', credit: '', memo: '' };
}

/** A new journal starts with the two lines every entry needs. */
export function emptyDraft(accountingDate: string, currencyCode: string): JournalDraft {
  return {
    accountingDate,
    documentDate: '',
    description: '',
    currencyCode,
    lines: [emptyLine(), emptyLine()],
  };
}

export type LineProblem =
  | 'no-account'
  | 'no-amount'
  | 'both-amounts'
  | 'invalid-amount'
  | 'negative-amount';

export interface JournalTotals {
  debitMinor: number;
  creditMinor: number;
  /** Debits less credits. Zero when balanced; the sign says which side is short. */
  differenceMinor: number;
  balanced: boolean;
}

/**
 * Per-line faults, indexed by position.
 *
 * A blank line — no account, no amounts, no memo — reports nothing. The editor starts with two
 * of them and flagging both before anything is typed makes the form look broken.
 */
export function lineProblems(lines: readonly JournalLineDraft[]): Map<number, LineProblem> {
  const problems = new Map<number, LineProblem>();

  lines.forEach((line, index) => {
    if (isBlankLine(line)) return;

    const debit = line.debit.trim();
    const credit = line.credit.trim();

    if (debit && credit) {
      problems.set(index, 'both-amounts');
      return;
    }

    const typed = debit || credit;
    if (!typed) {
      problems.set(index, 'no-amount');
      return;
    }

    // The strict parser: an unparseable amount must not read as a valid zero, or the
    // balance check below passes on a typo and the server rejects at posting.
    const minor = parseMinorUnits(typed, MONEY_SCALE);
    if (minor === null) {
      problems.set(index, 'invalid-amount');
      return;
    }
    if (minor < 0) {
      problems.set(index, 'negative-amount');
      return;
    }
    if (minor === 0) {
      // The server rejects a line whose debit and credit are both zero. Zero is a number, so
      // it parses — it is the amount that is wrong, not the text.
      problems.set(index, 'no-amount');
      return;
    }

    if (!line.accountId) problems.set(index, 'no-account');
  });

  return problems;
}

/** True when nothing has been entered on this line at all. */
export function isBlankLine(line: JournalLineDraft): boolean {
  return !line.accountId && !line.debit.trim() && !line.credit.trim() && !line.memo.trim();
}

/**
 * Column totals in minor units.
 *
 * Unparseable amounts contribute nothing rather than throwing — the totals are displayed live
 * while the user is still typing, and a half-entered "12." should read as "not yet" rather
 * than blanking the row. `lineProblems` is what refuses the save.
 */
export function journalTotals(lines: readonly JournalLineDraft[]): JournalTotals {
  let debitMinor = 0;
  let creditMinor = 0;

  for (const line of lines) {
    debitMinor += parseMinorUnits(line.debit.trim(), MONEY_SCALE) ?? 0;
    creditMinor += parseMinorUnits(line.credit.trim(), MONEY_SCALE) ?? 0;
  }

  const differenceMinor = debitMinor - creditMinor;

  return {
    debitMinor,
    creditMinor,
    differenceMinor,
    // Balanced requires something on both sides: two blank lines are equal at zero, and an
    // empty form is not a balanced journal.
    balanced: differenceMinor === 0 && debitMinor > 0,
  };
}

export type DraftProblem =
  | 'description-required'
  | 'accounting-date-required'
  | 'currency-required'
  | 'too-few-lines'
  | 'line-problems'
  | 'out-of-balance';

/**
 * Everything wrong with the draft, in the order a person would fix it: the header, then the
 * lines, then the balance. Empty means it can be saved.
 *
 * Balance is reported last on purpose. It is the fault that follows from the others — a line
 * missing its amount is also out of balance, and leading with that sends the user looking at
 * the totals instead of at the line.
 */
export function draftProblems(draft: JournalDraft): DraftProblem[] {
  const problems: DraftProblem[] = [];

  if (!draft.description.trim()) problems.push('description-required');
  if (!draft.accountingDate.trim()) problems.push('accounting-date-required');
  if (!draft.currencyCode.trim()) problems.push('currency-required');

  const filled = draft.lines.filter((l) => !isBlankLine(l));
  if (filled.length < 2) problems.push('too-few-lines');

  if (lineProblems(draft.lines).size > 0) problems.push('line-problems');

  const totals = journalTotals(draft.lines);
  if (filled.length >= 2 && !totals.balanced) problems.push('out-of-balance');

  return problems;
}

export function canSaveDraft(draft: JournalDraft): boolean {
  return draftProblems(draft).length === 0;
}

/**
 * Converts a validated draft into the request body.
 *
 * The one place decimal strings become the JS numbers `ManualJournalLineDto` requires (A9).
 * Parsing here rather than at the input keeps a single conversion point: the editor holds the
 * text the user typed, and nothing rounds until the request is built.
 *
 * Blank lines are dropped. The editor keeps a spare row for convenience and there is no reason
 * to send it.
 */
export function toJournalPayload(draft: JournalDraft): CreateJournalPayload {
  const lines = draft.lines
    .filter((line) => !isBlankLine(line))
    .map((line) => {
      const debitMinor = parseMinorUnits(line.debit.trim(), MONEY_SCALE) ?? 0;
      const creditMinor = parseMinorUnits(line.credit.trim(), MONEY_SCALE) ?? 0;

      return {
        accountId: line.accountId,
        // Exactly one side is sent. Sending the other as 0 is equivalent to the server, but
        // it makes a line's direction ambiguous to read back in a payload log.
        ...(debitMinor > 0 ? { debitAmount: debitMinor / 10 ** MONEY_SCALE } : {}),
        ...(creditMinor > 0 ? { creditAmount: creditMinor / 10 ** MONEY_SCALE } : {}),
        transactionCurrencyCode: draft.currencyCode,
        ...(line.memo.trim() ? { memo: line.memo.trim() } : {}),
      };
    });

  return {
    accountingDate: draft.accountingDate,
    ...(draft.documentDate.trim() ? { documentDate: draft.documentDate } : {}),
    description: draft.description.trim(),
    currencyCode: draft.currencyCode.trim().toUpperCase(),
    lines,
  };
}

/** Renders a minor-unit difference as the decimal string the message templates expect. */
export function formatDifference(differenceMinor: number): string {
  return fromMinorUnits(Math.abs(differenceMinor), MONEY_SCALE);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────────

export type JournalAction = 'submit' | 'approve' | 'reject' | 'post' | 'reverse';

/**
 * Which actions the server will accept from a journal's current status.
 *
 * Mirrors the `where` clauses in `ManualJournalService`: submit requires DRAFT, approve and
 * reject require SUBMITTED, post requires APPROVED, reverse requires POSTED. A REJECTED
 * journal goes back to the author, and the service accepts `submit` from it — the lifecycle
 * in §6.17 draws `REJECTED → DRAFT`, but no endpoint performs that transition, so resubmitting
 * directly is the only path back.
 */
export function availableActions(status: JournalStatus): JournalAction[] {
  switch (status) {
    case 'DRAFT':
      return ['submit'];
    case 'REJECTED':
      return ['submit'];
    case 'SUBMITTED':
      return ['approve', 'reject'];
    case 'APPROVED':
      return ['post'];
    case 'POSTED':
      return ['reverse'];
    case 'REVERSED':
      return [];
  }
}

/**
 * Totals of a saved journal's lines, for the detail screen.
 *
 * A posted journal is guaranteed balanced — the server refused it otherwise. A draft is not,
 * and the detail screen says so, because that is the one place someone reviewing an entry
 * before approving it can catch it.
 */
export function entryTotals(entry: Pick<JournalEntry, 'lines'>): JournalTotals {
  return journalTotals(
    entry.lines.map((line) => ({
      accountId: line.accountId,
      debit: line.debitAmount,
      credit: line.creditAmount,
      memo: line.description ?? '',
    })),
  );
}
