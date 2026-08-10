import { describe, expect, it } from 'vitest';

import { hasVat, planInvoicePost, rolesForInvoice } from './invoice-journal';
import type { Account, AccountVersion, ClientInvoice } from './types';

function version(overrides: Partial<AccountVersion> = {}): AccountVersion {
  return {
    id: 'ver-1',
    accountId: 'acc-1',
    versionNumber: 1,
    name: 'Accounts Receivable',
    nameAr: 'الذمم المدينة',
    parentAccountId: null,
    accountClass: 'ASSET',
    accountSubtype: 'ACCOUNTS_RECEIVABLE',
    isPostingAllowed: false,
    isControlAccount: true,
    controlledSubledgerType: 'ACCOUNTS_RECEIVABLE',
    controlPostingPolicy: 'SYSTEM_ONLY',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function account(code: string, ver: Partial<AccountVersion>): Account {
  return {
    id: `acc-${code}`,
    organizationId: 'org-1',
    code,
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [version(ver)],
  };
}

function chart(): Account[] {
  return [
    account('11000', { name: 'Accounts Receivable', nameAr: 'الذمم المدينة' }),
    account('42600', {
      name: 'Project Income',
      nameAr: 'إيرادات المشاريع',
      accountSubtype: 'PROJECT_REVENUE',
    }),
    account('20200', {
      name: 'Output VAT Payable',
      nameAr: 'ضريبة القيمة المضافة',
      accountSubtype: 'VAT_OUTPUT_PAYABLE',
    }),
  ];
}

function invoice(overrides: Partial<ClientInvoice> = {}): ClientInvoice {
  return {
    id: 'inv-1',
    organizationId: 'org-1',
    invoiceNumber: null,
    invoiceDate: '2026-08-10',
    dueDate: '2026-09-09',
    clientId: 'client-1',
    sourceIpcId: 'ipc-1',
    projectId: 'proj-1',
    contractId: 'con-1',
    currencyCode: 'SOS',
    subtotal: '6190.48',
    vatAmount: '307.52',
    totalAmount: '6498.00',
    outstandingAmount: '6498.00',
    paymentTerms: 'Net 30',
    documentStatus: 'APPROVED',
    postingStatus: 'NOT_POSTED',
    postedJournalEntryId: null,
    postedAt: null,
    postedBy: null,
    reversedAt: null,
    reversalJournalEntryId: null,
    cancelledAt: null,
    cancellationReason: null,
    approvedBy: null,
    approvedAt: null,
    createdAt: '2026-08-10T09:00:00.000Z',
    createdBy: 'user-1',
    ...overrides,
  };
}

const zeroVat = { subtotal: '6498.00', vatAmount: '0.00', totalAmount: '6498.00' };

describe('hasVat / rolesForInvoice', () => {
  it('needs a VAT account only when there is VAT', () => {
    expect(hasVat(invoice())).toBe(true);
    expect(rolesForInvoice(invoice())).toEqual(['AR_CONTROL', 'REVENUE', 'VAT_OUTPUT']);
  });

  it('does not demand a VAT account for a zero-VAT invoice', () => {
    expect(hasVat(invoice(zeroVat))).toBe(false);
    expect(rolesForInvoice(invoice(zeroVat))).toEqual(['AR_CONTROL', 'REVENUE']);
  });
});

describe('planInvoicePost — the three-line journal', () => {
  it('writes Dr AR = total, Cr revenue = subtotal, Cr VAT = vat', () => {
    const result = planInvoicePost(invoice(), chart(), 'en');
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.lines).toEqual([
      { accountCode: '11000', accountName: 'Accounts Receivable', debit: '6498.00', credit: null },
      { accountCode: '42600', accountName: 'Project Income', debit: null, credit: '6190.48' },
      { accountCode: '20200', accountName: 'Output VAT Payable', debit: null, credit: '307.52' },
    ]);
  });

  it('balances, in minor units rather than floats', () => {
    const result = planInvoicePost(invoice(), chart(), 'en');
    if (!result.ok) throw new Error('expected a plan');

    expect(result.plan.totalDebit).toBe('6498.00');
    expect(result.plan.totalCredit).toBe('6498.00');
    expect(result.plan.balanced).toBe(true);
  });

  it('omits the VAT line entirely when there is no VAT', () => {
    const result = planInvoicePost(invoice(zeroVat), chart(), 'en');
    if (!result.ok) throw new Error('expected a plan');

    expect(result.plan.lines).toHaveLength(2);
    expect(result.plan.lines.map((l) => l.accountCode)).toEqual(['11000', '42600']);
    expect(result.plan.balanced).toBe(true);
  });

  it('reports imbalance rather than offering to post it', () => {
    // total ≠ subtotal + vat. Should be impossible, so the plan says so instead of silently
    // sending a journal the posting engine will reject.
    const broken = invoice({ subtotal: '6000.00', vatAmount: '300.00', totalAmount: '6498.00' });

    const result = planInvoicePost(broken, chart(), 'en');
    if (!result.ok) throw new Error('expected a plan');

    expect(result.plan.balanced).toBe(false);
    expect(result.plan.totalDebit).toBe('6498.00');
    expect(result.plan.totalCredit).toBe('6300.00');
  });

  it('renders Arabic names without changing codes or amounts', () => {
    const en = planInvoicePost(invoice(), chart(), 'en');
    const ar = planInvoicePost(invoice(), chart(), 'ar');
    if (!en.ok || !ar.ok) throw new Error('expected plans');

    expect(ar.plan.lines[0]!.accountName).toBe('الذمم المدينة');
    expect(ar.plan.lines.map((l) => l.accountCode)).toEqual(en.plan.lines.map((l) => l.accountCode));
    expect(ar.plan.totalDebit).toBe(en.plan.totalDebit);
  });
});

describe('planInvoicePost — the payload it will send', () => {
  it('carries the resolved codes, and only those', () => {
    const result = planInvoicePost(invoice(), chart(), 'en');
    if (!result.ok) throw new Error('expected a plan');

    expect(result.plan.payload).toEqual({
      arAccountCode: '11000',
      revenueAccountCode: '42600',
      vatAccountCode: '20200',
    });
  });

  it('omits vatAccountCode rather than sending an empty string', () => {
    const result = planInvoicePost(invoice(zeroVat), chart(), 'en');
    if (!result.ok) throw new Error('expected a plan');

    expect(result.plan.payload).toEqual({
      arAccountCode: '11000',
      revenueAccountCode: '42600',
    });
    expect('vatAccountCode' in result.plan.payload).toBe(false);
  });

  it('sends exactly the codes the preview showed', () => {
    const result = planInvoicePost(invoice(), chart(), 'en');
    if (!result.ok) throw new Error('expected a plan');

    const { payload, lines } = result.plan;
    expect(lines.map((l) => l.accountCode)).toEqual([
      payload.arAccountCode,
      payload.revenueAccountCode,
      payload.vatAccountCode,
    ]);
  });
});

describe('planInvoicePost — when the chart cannot answer', () => {
  it('refuses, naming every unresolved role at once', () => {
    const bare = chart().filter((a) => a.code === '11000');

    const result = planInvoicePost(invoice(), bare, 'en');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.map((p) => p.role)).toEqual(['REVENUE', 'VAT_OUTPUT']);
  });

  it('reports AMBIGUOUS when two accounts claim the same role', () => {
    const conflicted = [...chart(), account('11010', { name: 'AR — Retentions' })];

    const result = planInvoicePost(invoice(), conflicted, 'en');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems[0]).toMatchObject({
      role: 'AR_CONTROL',
      problem: 'AMBIGUOUS',
    });
  });

  it('still plans a zero-VAT invoice on a chart with no VAT account', () => {
    const noVat = chart().filter((a) => a.code !== '20200');

    const result = planInvoicePost(invoice(zeroVat), noVat, 'en');

    expect(result.ok).toBe(true);
  });
});
