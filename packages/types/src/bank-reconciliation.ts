/**
 * Step 6 — bank reconciliation (`/finance/bank-statements`).
 *
 * A statement is imported for one bank account. Each statement line is matched to the ledger line
 * on the bank's GL account that moved the same money (that ledger line is then "cleared"), or — a
 * bank charge, interest — posted as a journal from the line. Amounts are signed decimal strings:
 * money in is positive.
 */
export type BankStatementStatus = 'OPEN' | 'RECONCILED';
export type StatementMatchStatus = 'UNMATCHED' | 'MATCHED' | 'POSTED';

export interface ImportStatementLine {
  transactionDate: string;
  description: string;
  reference?: string;
  /** Signed decimal string: money in positive, money out negative. */
  amount: string;
}

export interface ImportBankStatementRequest {
  bankAccountId: string;
  periodStart: string;
  statementDate: string;
  openingBalance: string;
  closingBalance: string;
  fileName?: string;
  lines: ImportStatementLine[];
}

export interface BankStatementSummary {
  id: string;
  bankAccountId: string;
  bankName: string;
  accountName: string;
  periodStart: string;
  statementDate: string;
  openingBalance: string;
  closingBalance: string;
  status: BankStatementStatus;
  lineCount: number;
  unmatchedCount: number;
  reconciledAt: string | null;
}

/** A ledger line on the bank's GL account, as the matching screen shows it. */
export interface BankLedgerLine {
  journalLineId: string;
  journalEntryId: string;
  journalNumber: string | null;
  accountingDate: string;
  description: string | null;
  /** Debit less credit: money in positive. */
  amount: string;
  /**
   * Dated before the account's first imported statement: taken as part of that statement's opening
   * balance, so it is not counted as outstanding (it can still be matched if it clears now).
   */
  broughtForward: boolean;
}

export interface BankStatementLineView {
  id: string;
  lineNumber: number;
  transactionDate: string;
  description: string;
  reference: string | null;
  amount: string;
  matchStatus: StatementMatchStatus;
  matched: BankLedgerLine | null;
  /** The unambiguous match the system proposes for an unmatched line, if any. */
  suggestion: BankLedgerLine | null;
}

export interface BankStatementWorkspace {
  statement: BankStatementSummary;
  lines: BankStatementLineView[];
  /** Ledger lines up to the statement date that no statement line has cleared — the matching candidates. */
  uncleared: BankLedgerLine[];
  reconciliation: {
    /** The bank GL balance at the statement date. */
    ledgerBalance: string;
    /** Sum of the uncleared ledger lines that are not brought forward (what the bank has not seen yet). */
    outstanding: string;
    adjustedLedger: string;
    statementClosing: string;
    /** statementClosing − adjustedLedger; zero when reconciled. */
    difference: string;
    balanced: boolean;
  };
  /** The previous reconciled statement's closing balance, to compare with this opening balance. */
  previousClosing: string | null;
  canReconcile: boolean;
}

export interface PostStatementLineRequest {
  /** The account the charge or interest goes to (the other side is the bank). */
  accountId: string;
  memo?: string;
}
