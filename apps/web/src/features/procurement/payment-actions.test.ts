import { describe, expect, it } from 'vitest';

import type { Account, BankAccount } from '@/features/accounting/types';

import {
  availablePaymentActions,
  bankAccountLabel,
  canPost,
  canReverse,
  payableBankAccounts,
  paymentBlockReason,
  planPaymentPost,
} from './payment-actions';
import type { SupplierPayment } from './types';

function account(id: string, code: string, name: string, subtype: string): Account {
  return {
    id,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        accountClass: 'ASSET',
        accountSubtype: subtype,
        normalBalance: 'DEBIT',
        isPostingAllowed: true,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        parentAccountId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  } as unknown as Account;
}

const AP = account('a-ap', '20000', 'Accounts Payable', 'ACCOUNTS_PAYABLE');
const ADVANCE = account('a-adv', '20100', 'Supplier Advance', 'SUPPLIER_ADVANCE');
const SALAAM_GL = account('a-bank1', '10100', 'Salaam Bank', 'CASH_AND_BANK');
const DAHAB_GL = account('a-bank2', '10200', 'Dahabshiil Bank', 'CASH_AND_BANK');

const ACCOUNTS = [AP, ADVANCE, SALAAM_GL, DAHAB_GL];

function bankAccount(overrides: Partial<BankAccount> = {}): BankAccount {
  return {
    id: 'bank-1',
    glAccountId: 'a-bank1',
    bankName: 'Salaam Bank',
    accountName: 'Main Operating',
    accountNumber: '000123454821',
    iban: null,
    swiftCode: null,
    currencyCode: 'USD',
    branch: null,
    allowsReceipts: true,
    allowsPayments: true,
    isReconcilable: true,
    status: 'ACTIVE',
    ...overrides,
  };
}

const BANKS = [bankAccount()];

function payment(overrides: Partial<SupplierPayment> = {}): SupplierPayment {
  return {
    id: 'pmt-1',
    paymentNumber: null,
    supplierId: 'sup-1',
    bankAccountId: 'bank-1',
    paymentDate: '2026-08-11',
    accountingDate: '2026-08-11',
    currencyCode: 'USD',
    totalAmount: '5000.00',
    allocatedAmount: '0.00',
    unallocatedAmount: '5000.00',
    paymentMethod: 'BANK_TRANSFER',
    bankReference: null,
    notes: null,
    documentStatus: 'APPROVED',
    postingStatus: 'NOT_POSTED',
    postedJournalEntryId: null,
    ...overrides,
  };
}

describe('payableBankAccounts', () => {
  /**
   * `allowsPayments` exists so a receipts-only account cannot be paid from, and nothing on the
   * server enforces it — `create` validates no foreign key at all (A16). This filter is the
   * only thing standing between a user and a payment drawn on a closed account.
   */
  it('excludes accounts that do not allow payments', () => {
    const receiptsOnly = bankAccount({ id: 'bank-2', allowsPayments: false });

    expect(payableBankAccounts([...BANKS, receiptsOnly]).map((b) => b.id)).toEqual(['bank-1']);
  });

  it('excludes suspended and closed accounts', () => {
    const suspended = bankAccount({ id: 'bank-3', status: 'SUSPENDED' });
    const closed = bankAccount({ id: 'bank-4', status: 'CLOSED' });

    expect(payableBankAccounts([...BANKS, suspended, closed]).map((b) => b.id)).toEqual([
      'bank-1',
    ]);
  });

  it('sorts by bank then account name, so the order is stable', () => {
    const zAccount = bankAccount({ id: 'b-z', bankName: 'Zamzam', accountName: 'Payroll' });
    const aSecond = bankAccount({ id: 'b-a2', bankName: 'Salaam Bank', accountName: 'Alpha' });

    expect(payableBankAccounts([zAccount, ...BANKS, aSecond]).map((b) => b.id)).toEqual([
      'b-a2',
      'bank-1',
      'b-z',
    ]);
  });
});

describe('bankAccountLabel', () => {
  it('masks the account number to its last four digits', () => {
    expect(bankAccountLabel(bankAccount())).toBe('Salaam Bank · Main Operating — ****4821');
  });
});

describe('payment lifecycle gates', () => {
  it('walks DRAFT → APPROVED → POSTED, one action at a time', () => {
    expect(availablePaymentActions(payment({ documentStatus: 'DRAFT' }))).toEqual(['approve']);
    expect(availablePaymentActions(payment({ documentStatus: 'APPROVED' }))).toEqual(['post']);
    expect(
      availablePaymentActions(payment({ documentStatus: 'APPROVED', postingStatus: 'POSTED' })),
    ).toEqual(['reverse']);
  });

  it('offers post again after a FAILED attempt', () => {
    expect(canPost(payment({ postingStatus: 'FAILED' }))).toBe(true);
  });

  /** Same divergence as bills and invoices: the server would re-post a REVERSED payment. */
  it('refuses to re-post a REVERSED payment, unlike the server', () => {
    const reversed = payment({ postingStatus: 'REVERSED' });

    expect(canPost(reversed)).toBe(false);
    expect(paymentBlockReason(reversed, 'post')).toBe('already-reversed');
  });

  it('only offers reverse on a posted payment', () => {
    expect(canReverse(payment({ postingStatus: 'POSTED' }))).toBe(true);
    expect(paymentBlockReason(payment({ postingStatus: 'NOT_POSTED' }), 'reverse')).toBe(
      'not-posted',
    );
  });
});

describe('planPaymentPost', () => {
  /**
   * The case every payment this UI raises will hit: wholly unallocated, because the create
   * form cannot send `allocations[]` (A16).
   */
  it('writes Dr Supplier Advance / Cr Bank for an unallocated advance', () => {
    const result = planPaymentPost(payment(), ACCOUNTS, BANKS, 'en');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.lines).toEqual([
      { accountCode: '20100', accountName: 'Supplier Advance', debit: '5000.00', credit: null },
      { accountCode: '10100', accountName: 'Salaam Bank', debit: null, credit: '5000.00' },
    ]);
  });

  it('writes Dr AP / Cr Bank when the payment is wholly allocated', () => {
    const allocated = payment({ allocatedAmount: '5000.00', unallocatedAmount: '0.00' });
    const result = planPaymentPost(allocated, ACCOUNTS, BANKS, 'en');
    if (!result.ok) return;

    expect(result.plan.lines.map((l) => l.accountCode)).toEqual(['20000', '10100']);
  });

  it('writes all three lines for a part-allocated payment', () => {
    const mixed = payment({ allocatedAmount: '2000.00', unallocatedAmount: '3000.00' });
    const result = planPaymentPost(mixed, ACCOUNTS, BANKS, 'en');
    if (!result.ok) return;

    expect(result.plan.lines).toHaveLength(3);
    expect(result.plan.lines[0]).toMatchObject({ accountCode: '20000', debit: '2000.00' });
    expect(result.plan.lines[1]).toMatchObject({ accountCode: '20100', debit: '3000.00' });
    expect(result.plan.lines[2]).toMatchObject({ accountCode: '10100', credit: '5000.00' });
    expect(result.plan.balanced).toBe(true);
  });

  /**
   * The bank line has to come from the payment's own bank account. A subtype scan would find
   * both seeded CASH_AND_BANK accounts and could not say which one the money left.
   */
  it('credits the GL account behind the payment’s bank account, not the first bank in the chart', () => {
    const second = bankAccount({ id: 'bank-2', glAccountId: 'a-bank2', bankName: 'Dahabshiil' });
    const result = planPaymentPost(
      payment({ bankAccountId: 'bank-2' }),
      ACCOUNTS,
      [...BANKS, second],
      'en',
    );
    if (!result.ok) return;

    expect(result.plan.lines.at(-1)).toMatchObject({ accountCode: '10200' });
    expect(result.plan.payload.bankGlCode).toBe('10200');
  });

  it('sends all three codes even when a branch contributes no line', () => {
    const result = planPaymentPost(payment(), ACCOUNTS, BANKS, 'en');
    if (!result.ok) return;

    expect(result.plan.payload).toEqual({
      apAccountCode: '20000',
      bankGlCode: '10100',
      supplierAdvanceCode: '20100',
    });
  });

  it('refuses when the payment’s bank account is not in the list', () => {
    const result = planPaymentPost(payment({ bankAccountId: 'gone' }), ACCOUNTS, BANKS, 'en');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.missingBank).toBe(true);
  });

  it('refuses when the chart has no Supplier Advance account', () => {
    const result = planPaymentPost(
      payment(),
      ACCOUNTS.filter((a) => a.id !== ADVANCE.id),
      BANKS,
      'en',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map((p) => p.role)).toContain('SUPPLIER_ADVANCE');
  });

  it('reports an inconsistent payment as unbalanced rather than posting it', () => {
    const wrong = payment({ allocatedAmount: '1000.00', unallocatedAmount: '1000.00' });
    const result = planPaymentPost(wrong, ACCOUNTS, BANKS, 'en');
    if (!result.ok) return;

    expect(result.plan.balanced).toBe(false);
  });
});
