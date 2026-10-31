import { describe, expect, it } from 'vitest';

import { heldByKind, ledgerLineHref, maskedAccountNumber, moneyInOut } from './bank-account-figures';
import type { BankAccount } from './types';

const account = (over: Partial<BankAccount>): BankAccount => ({
  id: 'a', glAccountId: 'g', bankName: 'Salaam', accountName: 'Operating', accountNumber: '0012345678', iban: null, swiftCode: null,
  currencyCode: 'USD', branch: null, kind: 'BANK', allowsReceipts: true, allowsPayments: true, isReconcilable: true, status: 'ACTIVE',
  bookBalance: '0.00', ...over,
});

describe('bank account figures (BK)', () => {
  it('adds what is held by kind, leaving closed accounts out', () => {
    const held = heldByKind([
      account({ bookBalance: '14340.00' }),
      account({ id: 'b', kind: 'CASH', bookBalance: '800.00' }),
      account({ id: 'c', kind: 'MOBILE_WALLET', bookBalance: '125.50' }),
      account({ id: 'd', status: 'CLOSED', bookBalance: '999.00' }),
    ]);
    expect(held).toEqual({ total: '15265.50', BANK: '14340.00', CASH: '800.00', MOBILE_WALLET: '125.50', count: 3 });
  });

  it('masks a number to its last four, and says nothing for a placeholder', () => {
    expect(maskedAccountNumber('0012345678', () => true)).toBe('****5678');
    expect(maskedAccountNumber('PENDING-1', () => false)).toBeNull();
  });

  it('splits a ledger line into money in and money out', () => {
    expect(moneyInOut({ debitAmount: '12500.00', creditAmount: '0.00' })).toEqual({ moneyIn: '12500.00', moneyOut: null });
    expect(moneyInOut({ debitAmount: '0', creditAmount: '640.00' })).toEqual({ moneyIn: null, moneyOut: '640.00' });
  });

  it('opens the document a line came from, and a reversal opens what it reversed', () => {
    expect(ledgerLineHref({ sourceDocumentType: 'SUPPLIER_PAYMENT', sourceDocumentId: 'p1', journalEntryId: 'j' })).toBe('/finance/accounting/payments/p1');
    expect(ledgerLineHref({ sourceDocumentType: 'PAYMENT_RECEIPT', sourceDocumentId: 'r1', journalEntryId: 'j' })).toBe('/receipts/r1');
    expect(ledgerLineHref({ sourceDocumentType: 'BANK_TRANSFER', sourceDocumentId: 'reversal-t1', journalEntryId: 'j' })).toBe('/finance/accounting/transfers?highlight=t1');
    expect(ledgerLineHref({ sourceDocumentType: 'BANK_STATEMENT', sourceDocumentId: 'l1', journalEntryId: 'j9' })).toBe('/finance/accounting/journals/j9');
  });
});
