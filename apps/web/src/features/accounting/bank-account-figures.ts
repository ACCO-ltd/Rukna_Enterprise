import { fromMinorUnits, toMinorUnits } from '@/lib/money';

import type { BankAccount, BankAccountKind, LedgerLine } from './types';

/**
 * BK — the figures the bank and cash screens show: what is held, by kind of account, and where a
 * line in an account's ledger came from.
 */

export const BANK_ACCOUNT_HREF = (id: string) => `/finance/accounting/bank-accounts/${id}`;

/** `****5678`; null when no real number was recorded (the setup wizard's placeholder). */
export function maskedAccountNumber(accountNumber: string, recorded: (n: string) => boolean): string | null {
  if (!recorded(accountNumber)) return null;
  return `****${accountNumber.slice(-4)}`;
}

export interface HeldByKind {
  total: string;
  BANK: string;
  CASH: string;
  MOBILE_WALLET: string;
  /** Accounts counted: every one not closed. */
  count: number;
}

/** What the books say is held, across every open (or suspended) account and by kind. */
export function heldByKind(accounts: readonly BankAccount[]): HeldByKind {
  const minor: Record<BankAccountKind, number> = { BANK: 0, CASH: 0, MOBILE_WALLET: 0 };
  let count = 0;
  for (const a of accounts) {
    if (a.status === 'CLOSED') continue;
    count += 1;
    minor[a.kind ?? 'BANK'] += toMinorUnits(a.bookBalance ?? '0', 2);
  }
  const total = minor.BANK + minor.CASH + minor.MOBILE_WALLET;
  return {
    total: fromMinorUnits(total, 2),
    BANK: fromMinorUnits(minor.BANK, 2),
    CASH: fromMinorUnits(minor.CASH, 2),
    MOBILE_WALLET: fromMinorUnits(minor.MOBILE_WALLET, 2),
    count,
  };
}

/** Money in (debit) and money out (credit) of a bank ledger line, as the account page shows them. */
export function moneyInOut(line: Pick<LedgerLine, 'debitAmount' | 'creditAmount'>): { moneyIn: string | null; moneyOut: string | null } {
  const debit = toMinorUnits(line.debitAmount, 2);
  const credit = toMinorUnits(line.creditAmount, 2);
  return { moneyIn: debit > 0 ? fromMinorUnits(debit, 2) : null, moneyOut: credit > 0 ? fromMinorUnits(credit, 2) : null };
}

/** The screen a bank ledger line came from; the journal itself when there is no better one. */
export function ledgerLineHref(line: Pick<LedgerLine, 'sourceDocumentType' | 'sourceDocumentId' | 'journalEntryId'>): string {
  const id = line.sourceDocumentId;
  // Reversals carry `reversal-<id>`: they open the document they reversed.
  const own = id?.startsWith('reversal-') ? id.slice('reversal-'.length) : id;
  switch (line.sourceDocumentType) {
    case 'SUPPLIER_PAYMENT':
      return own ? `/finance/accounting/payments/${own}` : journal(line.journalEntryId);
    case 'PAYMENT_RECEIPT':
      return own ? `/receipts/${own}` : journal(line.journalEntryId);
    case 'SUPPLIER_BILL':
      return own ? `/finance/accounting/bills/${own}` : journal(line.journalEntryId);
    case 'CLIENT_INVOICE':
      return own ? `/finance/accounting/invoices/${own}` : journal(line.journalEntryId);
    case 'BANK_TRANSFER':
      return own ? `/finance/accounting/transfers?highlight=${own}` : journal(line.journalEntryId);
    default:
      return journal(line.journalEntryId);
  }
}

const journal = (id: string) => `/finance/accounting/journals/${id}`;
