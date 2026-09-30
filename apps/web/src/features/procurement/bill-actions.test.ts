import { describe, expect, it } from 'vitest';

import type { Account, PostingProfile } from '@/features/accounting/types';

import {
  availableBillActions,
  billBlockReason,
  billLifecycle,
  billNotice,
  primaryBillAction,
  canEditBill,
  canPost,
  canReject,
  canReturn,
  canReverse,
  expenseProfiles,
  planBillPost,
} from './bill-actions';
import type { SupplierBill } from './types';

// ─── Fixtures ────────────────────────────────────────────────────────────────────

function account(
  id: string,
  code: string,
  name: string,
  accountClass: string,
  accountSubtype: string,
): Account {
  return {
    id,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `${id}-v1`,
        versionNumber: 1,
        name,
        accountClass,
        accountSubtype,
        normalBalance: accountClass === 'INCOME' ? 'CREDIT' : 'DEBIT',
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

/** The four profiles the seed actually creates, and the accounts they point at. */
const AP = account('a-ap', '20100', 'Accounts Payable', 'LIABILITY', 'ACCOUNTS_PAYABLE');
const COGS = account('a-cogs', '50303', 'Material Cost', 'COST_OF_SALES', 'DIRECT_MATERIAL');
const OFFICE = account('a-office', '60100', 'Office & Admin', 'EXPENSE', 'ADMIN_EXPENSE');
const REVENUE = account('a-rev', '42600', 'Project Revenue', 'INCOME', 'PROJECT_REVENUE');

const ACCOUNTS = [AP, COGS, OFFICE, REVENUE];

function profile(code: string, accountId: string, name: string): PostingProfile {
  return {
    id: `p-${code}`,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `p-${code}-v1`,
        versionNumber: 1,
        name,
        description: null,
        accountId,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  };
}

const PROFILES = [
  profile('MATERIAL_PURCHASE', COGS.id, 'Material Purchase (COGS)'),
  profile('OFFICE_EXPENSE', OFFICE.id, 'Office & Admin Expense'),
  profile('PROJECT_REVENUE', REVENUE.id, 'Project Revenue'),
];

function bill(overrides: Partial<SupplierBill> = {}): SupplierBill {
  return {
    id: 'bill-1',
    billNumber: null,
    supplierId: 'sup-1',
    supplier: { id: 'sup-1', code: 'SUP-001', name: 'Al-Rashid Trading' },
    supplierInvoiceNumber: 'INV-9001',
    billDate: '2026-08-01',
    dueDate: '2026-08-31',
    currencyCode: 'USD',
    documentStatus: 'APPROVED',
    postingStatus: 'NOT_POSTED',
    matchStatus: 'NOT_RUN',
    purchaseOrderId: null,
    purchaseOrderRevisionId: null,
    projectId: null,
    subtotal: '1000.00',
    vatAmount: '50.00',
    totalAmount: '1050.00',
    outstandingAmount: '1050.00',
    lines: [
      {
        id: 'l-1',
        lineNumber: 1,
        description: 'Cement',
        quantity: null,
        unitPrice: null,
        netAmount: '600.00',
        vatAmount: '30.00',
        grossAmount: '630.00',
        expenseProfileCode: 'MATERIAL_PURCHASE',
        projectId: null,
        boqNodeId: null,
      },
      {
        id: 'l-2',
        lineNumber: 2,
        description: 'Site office rent',
        quantity: null,
        unitPrice: null,
        netAmount: '400.00',
        vatAmount: '20.00',
        grossAmount: '420.00',
        expenseProfileCode: 'OFFICE_EXPENSE',
        projectId: null,
        boqNodeId: null,
      },
    ],
    ...overrides,
  };
}

// ─── Expense profile filtering ───────────────────────────────────────────────────

describe('expenseProfiles', () => {
  it('shows the account in force today, not a re-point scheduled for later', () => {
    const repointed: PostingProfile = {
      ...profile('MATERIAL_PURCHASE', COGS.id, 'Material Purchase (COGS)'),
      versions: [
        {
          id: 'v2',
          versionNumber: 2,
          name: 'Materials (from next year)',
          description: null,
          accountId: 'somewhere-else',
          effectiveFrom: '2999-01-01',
          effectiveTo: null,
        },
        {
          id: 'v1',
          versionNumber: 1,
          name: 'Material Purchase (COGS)',
          description: null,
          accountId: COGS.id,
          effectiveFrom: '2026-01-01',
          effectiveTo: '2999-01-01',
        },
      ],
    };

    const [only] = expenseProfiles([repointed], ACCOUNTS);

    expect(only?.account.id).toBe(COGS.id);
    expect(only?.name).toBe('Material Purchase (COGS)');
  });

  /**
   * The one that matters. The seed creates PROJECT_REVENUE pointing at an INCOME account;
   * offering it on a bill line would debit revenue. The journal balances, the trial balance
   * ties, and revenue is understated with nothing in any report to show it.
   */
  it('excludes a profile whose account is revenue', () => {
    const codes = expenseProfiles(PROFILES, ACCOUNTS).map((p) => p.code);

    expect(codes).not.toContain('PROJECT_REVENUE');
    expect(codes).toEqual(['MATERIAL_PURCHASE', 'OFFICE_EXPENSE']);
  });

  it('accepts both EXPENSE and COST_OF_SALES, since a bill can be either', () => {
    const classes = expenseProfiles(PROFILES, ACCOUNTS).map(
      (p) => p.account.versions[0]!.accountClass,
    );

    expect(classes).toContain('COST_OF_SALES');
    expect(classes).toContain('EXPENSE');
  });

  it('drops an INACTIVE profile', () => {
    const retired = [{ ...profile('OLD', OFFICE.id, 'Retired'), status: 'INACTIVE' as const }];

    expect(expenseProfiles(retired, ACCOUNTS)).toEqual([]);
  });

  it('drops a profile with no versions rather than throwing', () => {
    const versionless: PostingProfile = { id: 'p-x', code: 'X', status: 'ACTIVE', versions: [] };

    expect(() => expenseProfiles([versionless], ACCOUNTS)).not.toThrow();
    expect(expenseProfiles([versionless], ACCOUNTS)).toEqual([]);
  });

  it('drops a profile whose account is not in the chart', () => {
    const orphan = profile('ORPHAN', 'a-missing', 'Points nowhere');

    expect(expenseProfiles([orphan], ACCOUNTS)).toEqual([]);
  });

  it('surfaces the version name, which is what the user reads', () => {
    const material = expenseProfiles(PROFILES, ACCOUNTS).find(
      (p) => p.code === 'MATERIAL_PURCHASE',
    );

    expect(material?.name).toBe('Material Purchase (COGS)');
    expect(material?.account.code).toBe('50303');
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────────

describe('bill lifecycle gates', () => {
  it('walks DRAFT → SUBMITTED → APPROVED → POSTED, one action at a time', () => {
    expect(availableBillActions(bill({ documentStatus: 'DRAFT' }))).toEqual(['submit']);
    expect(availableBillActions(bill({ documentStatus: 'SUBMITTED' }))).toEqual([
      'approve',
      'return',
      'reject',
    ]);
    expect(availableBillActions(bill({ documentStatus: 'APPROVED' }))).toEqual(['post']);
    expect(
      availableBillActions(bill({ documentStatus: 'APPROVED', postingStatus: 'POSTED' })),
    ).toEqual(['reverse']);
  });

  it('offers post again after a FAILED attempt, because that is a retry', () => {
    expect(canPost(bill({ postingStatus: 'FAILED' }))).toBe(true);
  });

  it('does not offer post while one is PENDING', () => {
    expect(canPost(bill({ postingStatus: 'PENDING' }))).toBe(false);
  });

  /**
   * A11's shape, on the AP side. The server rejects only POSTED, so a REVERSED bill passes its
   * guard and can be posted a second time. This gate is deliberately stricter. Do not relax it
   * to match the server — fix the server.
   */
  it('refuses to re-post a REVERSED bill, unlike the server', () => {
    const reversed = bill({ documentStatus: 'APPROVED', postingStatus: 'REVERSED' });

    expect(canPost(reversed)).toBe(false);
    expect(billBlockReason(reversed, 'post')).toBe('already-reversed');
  });

  it('excludes OPENING_BALANCE, whose GL effect the opening journal already carries', () => {
    expect(canPost(bill({ postingStatus: 'OPENING_BALANCE' }))).toBe(false);
  });

  /**
   * P15. `canPostBill` blocks an unmatched PO-linked bill; the server permits it. Non-PO bills
   * never require matching, which is the case Tier B creates.
   */
  it('blocks posting an unmatched PO-linked bill, and allows an unmatched non-PO one', () => {
    const linked = bill({ purchaseOrderRevisionId: 'rev-1', matchStatus: 'NOT_RUN' });
    expect(canPost(linked)).toBe(false);
    expect(billBlockReason(linked, 'post')).toBe('unmatched');

    expect(canPost(bill({ purchaseOrderRevisionId: null, matchStatus: 'NOT_RUN' }))).toBe(true);
  });

  it('only offers reverse on a posted bill', () => {
    expect(canReverse(bill({ postingStatus: 'POSTED' }))).toBe(true);
    expect(canReverse(bill({ postingStatus: 'NOT_POSTED' }))).toBe(false);
    expect(billBlockReason(bill({ postingStatus: 'NOT_POSTED' }), 'reverse')).toBe('not-posted');
  });

  it('offers return and reject only on a SUBMITTED bill', () => {
    const statuses = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
    for (const documentStatus of statuses) {
      const b = bill({ documentStatus });
      expect(canReturn(b)).toBe(documentStatus === 'SUBMITTED');
      expect(canReject(b)).toBe(documentStatus === 'SUBMITTED');
    }
    expect(billBlockReason(bill({ documentStatus: 'APPROVED' }), 'return')).toBe('not-submitted');
    expect(billBlockReason(bill({ documentStatus: 'DRAFT' }), 'reject')).toBe('not-submitted');
    expect(billBlockReason(bill({ documentStatus: 'SUBMITTED' }), 'reject')).toBeNull();
  });

  it('never offers Reject to the person who entered the bill; Return stays theirs', () => {
    const mine = bill({ documentStatus: 'SUBMITTED', createdBy: 'u-clerk' });
    expect(canReject(mine, 'u-clerk')).toBe(false);
    expect(canReject(mine, 'u-approver')).toBe(true);
    expect(availableBillActions(mine, 'u-clerk')).toContain('return');
    expect(availableBillActions(mine, 'u-clerk')).not.toContain('reject');
  });

  it('lets only a DRAFT bill be edited — new or returned', () => {
    expect(canEditBill(bill({ documentStatus: 'DRAFT' }))).toBe(true);
    expect(canEditBill(bill({ documentStatus: 'DRAFT', returnedAt: '2026-09-20T10:00:00Z' }))).toBe(true);
    expect(canEditBill(bill({ documentStatus: 'SUBMITTED' }))).toBe(false);
    expect(canEditBill(bill({ documentStatus: 'REJECTED' }))).toBe(false);
    expect(canEditBill(bill({ documentStatus: 'APPROVED' }))).toBe(false);
  });

  it('offers nothing on a REJECTED bill — rejection is final', () => {
    expect(availableBillActions(bill({ documentStatus: 'REJECTED' }))).toEqual([]);
  });

  it('names why each action is blocked, for the disabled tooltip', () => {
    expect(billBlockReason(bill({ documentStatus: 'APPROVED' }), 'submit')).toBe('not-draft');
    expect(billBlockReason(bill({ documentStatus: 'DRAFT' }), 'approve')).toBe('not-submitted');
    expect(billBlockReason(bill({ documentStatus: 'DRAFT' }), 'post')).toBe('not-approved');
    expect(billBlockReason(bill({ documentStatus: 'DRAFT' }), 'submit')).toBeNull();
  });
});

// ─── Post plan ───────────────────────────────────────────────────────────────────

describe('planBillPost', () => {
  it('writes one debit per line and a single credit to AP', () => {
    const result = planBillPost(bill(), ACCOUNTS, PROFILES, 'en');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.lines).toHaveLength(3);

    const [first, second, credit] = result.plan.lines;
    expect(first).toMatchObject({ accountCode: '50303', debit: '630.00', credit: null });
    expect(second).toMatchObject({ accountCode: '60100', debit: '420.00', credit: null });
    expect(credit).toMatchObject({ accountCode: '20100', debit: null, credit: '1050.00' });
  });

  /**
   * ACCO's VAT is non-recoverable, so the whole gross goes to expense. A preview built on net
   * would understate every line by its VAT and disagree with the credit.
   */
  it('debits gross, not net', () => {
    const result = planBillPost(bill(), ACCOUNTS, PROFILES, 'en');
    if (!result.ok) return;

    expect(result.plan.totalDebit).toBe('1050.00');
    expect(result.plan.totalDebit).not.toBe('1000.00');
  });

  it('balances, and says so', () => {
    const result = planBillPost(bill(), ACCOUNTS, PROFILES, 'en');
    if (!result.ok) return;

    expect(result.plan.totalDebit).toBe(result.plan.totalCredit);
    expect(result.plan.balanced).toBe(true);
  });

  it('reports an inconsistent bill as unbalanced rather than posting it', () => {
    const wrong = planBillPost(bill({ totalAmount: '999.00' }), ACCOUNTS, PROFILES, 'en');
    if (!wrong.ok) return;

    expect(wrong.plan.balanced).toBe(false);
  });

  it('sends only the AP account code — the expense accounts are resolved server-side', () => {
    const result = planBillPost(bill(), ACCOUNTS, PROFILES, 'en');
    if (!result.ok) return;

    expect(result.plan.payload).toEqual({ apAccountCode: '20100' });
  });

  it('refuses when no account is marked ACCOUNTS_PAYABLE', () => {
    const chartWithoutAp = ACCOUNTS.filter((a) => a.id !== AP.id);
    const result = planBillPost(bill(), chartWithoutAp, PROFILES, 'en');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.problem).toBe('NOT_CONFIGURED');
  });

  it('refuses when two accounts claim ACCOUNTS_PAYABLE', () => {
    const second = account('a-ap2', '20101', 'AP (duplicate)', 'LIABILITY', 'ACCOUNTS_PAYABLE');
    const result = planBillPost(bill(), [...ACCOUNTS, second], PROFILES, 'en');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem.problem).toBe('AMBIGUOUS');
  });

  /**
   * A line naming a profile that no longer resolves still has to render — the server will
   * reject the post, and a blank row explains nothing. The code is shown in place of a name.
   */
  it('falls back to the profile code when a line names an unresolvable profile', () => {
    const stale = bill({
      lines: [{ ...bill().lines![0]!, expenseProfileCode: 'RETIRED_PROFILE' }],
    });
    const result = planBillPost(stale, ACCOUNTS, PROFILES, 'en');
    if (!result.ok) return;

    expect(result.plan.lines[0]).toMatchObject({
      accountCode: 'RETIRED_PROFILE',
      accountName: 'RETIRED_PROFILE',
    });
  });

  it('handles a bill whose lines have not been loaded', () => {
    const result = planBillPost(bill({ lines: undefined }), ACCOUNTS, PROFILES, 'en');
    if (!result.ok) return;

    expect(result.plan.totalDebit).toBe('0.00');
    expect(result.plan.balanced).toBe(false);
  });
});

// ─── The document page (ADR-035) ─────────────────────────────────────────────────

describe('billLifecycle', () => {
  it('follows document status along the main line', () => {
    expect(billLifecycle(bill({ documentStatus: 'DRAFT' }))).toEqual({ current: 'DRAFT', terminal: null });
    expect(billLifecycle(bill({ documentStatus: 'SUBMITTED' }))).toEqual({ current: 'SUBMITTED', terminal: null });
    expect(billLifecycle(bill({ documentStatus: 'APPROVED' }))).toEqual({ current: 'APPROVED', terminal: null });
  });

  it('lets posting status outrank document status', () => {
    expect(billLifecycle(bill({ postingStatus: 'POSTED' }))).toEqual({ current: 'POSTED', terminal: null });
    expect(billLifecycle(bill({ postingStatus: 'REVERSED' }))).toEqual({ current: 'POSTED', terminal: 'REVERSED' });
  });

  it('draws rejection and cancellation as terminals off the main line', () => {
    expect(billLifecycle(bill({ documentStatus: 'REJECTED' })).terminal).toBe('REJECTED');
    expect(billLifecycle(bill({ documentStatus: 'CANCELLED' })).terminal).toBe('CANCELLED');
  });
});

describe('primaryBillAction', () => {
  it('is the next step along the main line', () => {
    expect(primaryBillAction(bill({ documentStatus: 'DRAFT' }))).toBe('submit');
    expect(primaryBillAction(bill({ documentStatus: 'SUBMITTED' }))).toBe('approve');
    expect(primaryBillAction(bill({ documentStatus: 'APPROVED' }))).toBe('post');
  });

  it('stays approve for a SUBMITTED bill — return and reject are never primary', () => {
    expect(primaryBillAction(bill({ documentStatus: 'SUBMITTED' }))).toBe('approve');
  });

  it('is nothing on a REJECTED bill', () => {
    expect(primaryBillAction(bill({ documentStatus: 'REJECTED' }))).toBeNull();
  });

  it('is never reverse, and nothing once posted', () => {
    expect(primaryBillAction(bill({ postingStatus: 'POSTED' }))).toBeNull();
    expect(primaryBillAction(bill({ postingStatus: 'REVERSED' }))).toBeNull();
  });

  it('is nothing while a PO match blocks posting — the notice explains instead', () => {
    const blocked = bill({ purchaseOrderRevisionId: 'rev-1', matchStatus: 'EXCEPTION' });
    expect(primaryBillAction(blocked)).toBeNull();
    expect(billNotice(blocked)).toBe('post-blocked');
  });
});

describe('billNotice', () => {
  it('explains each posting outcome once', () => {
    expect(billNotice(bill({ postingStatus: 'FAILED' }))).toBe('post-failed');
    expect(billNotice(bill({ postingStatus: 'PENDING' }))).toBe('posting-pending');
    expect(billNotice(bill({ postingStatus: 'POSTED' }))).toBe('posted');
    expect(billNotice(bill({ postingStatus: 'REVERSED' }))).toBe('reversed');
  });

  it('says a DRAFT bill was returned for correction, only while it is still a draft', () => {
    expect(billNotice(bill({ documentStatus: 'DRAFT', returnedAt: '2026-09-20T10:00:00Z' }))).toBe(
      'returned',
    );
    // Resubmitted: the return is history now, not a notice.
    expect(
      billNotice(bill({ documentStatus: 'SUBMITTED', returnedAt: '2026-09-20T10:00:00Z' })),
    ).toBeNull();
  });

  it('says a REJECTED bill was rejected', () => {
    expect(billNotice(bill({ documentStatus: 'REJECTED', rejectedAt: '2026-09-20T10:00:00Z' }))).toBe(
      'rejected',
    );
  });

  it('says nothing when the state speaks for itself', () => {
    expect(billNotice(bill({ documentStatus: 'DRAFT' }))).toBeNull();
    expect(billNotice(bill({ documentStatus: 'APPROVED' }))).toBeNull();
  });
});
