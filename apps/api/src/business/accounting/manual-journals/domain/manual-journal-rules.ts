import { parseDateOnly } from '../../accounting-core/domain/calendar-day.js';

/** ADR-024 — the ledger keeps one currency; a manual journal is written in it. */
export const JOURNAL_CURRENCY = 'USD';

export interface JournalLineFact {
  debitAmount?: number | null;
  creditAmount?: number | null;
}

export interface JournalFacts {
  accountingDate: string;
  documentDate?: string | null;
  autoReverseOn?: string | null;
  currencyCode?: string | null;
  lines: readonly JournalLineFact[];
}

export interface JournalProblem {
  errorCode: string;
  message: string;
  line?: number;
}

const cents = (value: number | null | undefined): number | null => {
  const v = value ?? 0;
  const minor = Math.round(v * 100);
  return Math.abs(v * 100 - minor) > 1e-6 ? null : minor;
};

/** A YYYY-MM-DD that is a real day, or null. */
export const journalDay = (value: string | null | undefined) =>
  value && value.length >= 10 ? parseDateOnly(value) : null;

/**
 * GL-J — what is wrong with a manual journal as written, or null. Checked when it is saved, not
 * only when it posts: an unbalanced or impossible journal must not reach someone's approval queue.
 */
export function journalProblem(j: JournalFacts): JournalProblem | null {
  const accounting = journalDay(j.accountingDate);
  if (!accounting) return { errorCode: 'JOURNAL_DATE_INVALID', message: 'The accounting date must be a real date written YYYY-MM-DD.' };
  if (j.documentDate && !journalDay(j.documentDate)) {
    return { errorCode: 'JOURNAL_DATE_INVALID', message: 'The document date must be a real date written YYYY-MM-DD.' };
  }
  if (j.autoReverseOn) {
    const reverse = journalDay(j.autoReverseOn);
    if (!reverse) return { errorCode: 'AUTO_REVERSE_DATE_INVALID', message: 'The reversal date must be a real date written YYYY-MM-DD.' };
    if (reverse <= accounting) {
      return {
        errorCode: 'AUTO_REVERSE_DATE_INVALID',
        message: 'The automatic reversal must be dated after the journal — usually the first day of the next month.',
      };
    }
  }
  if ((j.currencyCode ?? JOURNAL_CURRENCY).toUpperCase() !== JOURNAL_CURRENCY) {
    return { errorCode: 'CURRENCY_NOT_SUPPORTED', message: `Journals are written in ${JOURNAL_CURRENCY}, the currency of the ledger.` };
  }
  if (j.lines.length < 2) return { errorCode: 'JOURNAL_TOO_FEW_LINES', message: 'A journal needs at least two lines.' };

  let debit = 0;
  let credit = 0;
  for (const [i, line] of j.lines.entries()) {
    const d = cents(line.debitAmount);
    const c = cents(line.creditAmount);
    if (d === null || c === null) {
      return { errorCode: 'AMOUNT_PRECISION', message: `Line ${i + 1}: amounts go to the cent (two decimal places).`, line: i + 1 };
    }
    if ((d > 0) === (c > 0)) {
      return { errorCode: 'LINE_ONE_SIDE', message: `Line ${i + 1} needs a debit or a credit, not both and not neither.`, line: i + 1 };
    }
    debit += d;
    credit += c;
  }
  if (debit !== credit) {
    return {
      errorCode: 'JOURNAL_UNBALANCED',
      message: `Debits ${(debit / 100).toFixed(2)} and credits ${(credit / 100).toFixed(2)} must be equal.`,
    };
  }
  return null;
}

export interface JournalAccountFact {
  code: string;
  name: string;
  active: boolean;
  /** "Posting allowed" — open to direct entries. Off on headings, control and system-only accounts. */
  postingAllowed: boolean;
  control: boolean;
  systemOnly: boolean;
}

/** Why a journal line cannot use this account, or null. */
export function journalAccountProblem(line: number, account: JournalAccountFact | null): JournalProblem | null {
  if (!account) return { errorCode: 'ACCOUNT_NOT_FOUND', message: `Line ${line}: the account does not exist.`, line };
  const label = `${account.code} ${account.name}`;
  if (!account.active) return { errorCode: 'ACCOUNT_INACTIVE', message: `Line ${line}: ${label} is inactive.`, line };
  if (account.systemOnly || (account.control && !account.postingAllowed)) {
    return {
      errorCode: 'ACCOUNT_SYSTEM_ONLY',
      message: `Line ${line}: ${label} is kept by the system from invoices, bills and payments; it takes no manual journals.`,
      line,
    };
  }
  if (!account.postingAllowed) {
    return { errorCode: 'ACCOUNT_NOT_POSTABLE', message: `Line ${line}: ${label} is a heading — choose an account under it.`, line };
  }
  return null;
}

/** A reversal is dated on or after the journal it reverses. */
export function reversalDateProblem(reversalDate: string, journalDate: Date): JournalProblem | null {
  const day = journalDay(reversalDate);
  if (!day) return { errorCode: 'REVERSAL_DATE_INVALID', message: 'The reversal date must be a real date written YYYY-MM-DD.' };
  if (day < journalDate) {
    return {
      errorCode: 'REVERSAL_BEFORE_JOURNAL',
      message: `A reversal cannot be dated before the journal it reverses (${journalDate.toISOString().slice(0, 10)}).`,
    };
  }
  return null;
}

/** The statuses a journal can be cancelled from: anything not yet in the ledger. */
export const CANCELLABLE_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
