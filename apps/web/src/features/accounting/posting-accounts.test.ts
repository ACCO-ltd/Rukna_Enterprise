import { describe, expect, it } from 'vitest';

import {
  bankAccounts,
  resolvePostingAccount,
  resolvePostingAccounts,
} from './posting-accounts';
import type { Account, AccountVersion } from './types';

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

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-ar',
    organizationId: 'org-1',
    code: '11000',
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [version()],
    ...overrides,
  };
}

/** The subset of the seeded chart that the AR and AP posting paths actually reach. */
function seededChart(): Account[] {
  return [
    account({
      id: 'acc-bank-1',
      code: '10100',
      versions: [version({ name: 'Salaam Bank', accountSubtype: 'CASH_AND_BANK' })],
    }),
    account({
      id: 'acc-bank-2',
      code: '10200',
      versions: [version({ name: 'Dahabshiil Bank', accountSubtype: 'CASH_AND_BANK' })],
    }),
    account({ id: 'acc-ar', code: '11000' }),
    account({
      id: 'acc-unapplied',
      code: '11500',
      normalBalance: 'CREDIT',
      versions: [
        version({ name: 'Unapplied Client Receipts', accountSubtype: 'UNAPPLIED_CLIENT_RECEIPTS' }),
      ],
    }),
    account({
      id: 'acc-ap',
      code: '20000',
      normalBalance: 'CREDIT',
      versions: [version({ name: 'Accounts Payable', accountSubtype: 'ACCOUNTS_PAYABLE' })],
    }),
    account({
      id: 'acc-advance',
      code: '20100',
      versions: [version({ name: 'Supplier Advance', accountSubtype: 'SUPPLIER_ADVANCE' })],
    }),
    account({
      id: 'acc-vat',
      code: '20200',
      normalBalance: 'CREDIT',
      versions: [version({ name: 'Output VAT Payable', accountSubtype: 'VAT_OUTPUT_PAYABLE' })],
    }),
    account({
      id: 'acc-revenue',
      code: '42600',
      normalBalance: 'CREDIT',
      versions: [version({ name: 'Project Income', accountSubtype: 'PROJECT_REVENUE' })],
    }),
  ];
}

describe('resolvePostingAccount — the seeded chart', () => {
  it.each([
    ['AR_CONTROL', '11000'],
    ['REVENUE', '42600'],
    ['VAT_OUTPUT', '20200'],
    ['UNAPPLIED_RECEIPTS', '11500'],
    ['AP_CONTROL', '20000'],
    ['SUPPLIER_ADVANCE', '20100'],
  ] as const)('resolves %s to %s', (role, code) => {
    const result = resolvePostingAccount(seededChart(), role);

    expect(result.ok).toBe(true);
    expect(result.ok && result.code).toBe(code);
  });
});

describe('resolvePostingAccount — when the chart cannot answer', () => {
  it('reports NOT_CONFIGURED when no account carries the subtype', () => {
    const chart = seededChart().filter((a) => a.code !== '20200');

    const result = resolvePostingAccount(chart, 'VAT_OUTPUT');

    expect(result).toMatchObject({ ok: false, problem: 'NOT_CONFIGURED', role: 'VAT_OUTPUT' });
  });

  it('reports AMBIGUOUS rather than picking the first of two', () => {
    const chart = [
      ...seededChart(),
      account({
        id: 'acc-ar-2',
        code: '11010',
        versions: [version({ name: 'AR — Retentions' })],
      }),
    ];

    const result = resolvePostingAccount(chart, 'AR_CONTROL');

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ problem: 'AMBIGUOUS' });
    // Both codes are returned so the message can name them; an administrator needs to know
    // which two rows are in conflict.
    expect(!result.ok && result.candidates.map((a) => a.code).sort()).toEqual(['11000', '11010']);
  });

  it('ignores an INACTIVE duplicate — deactivating one is how the conflict gets fixed', () => {
    const chart = [
      ...seededChart(),
      account({
        id: 'acc-ar-old',
        code: '11009',
        status: 'INACTIVE',
        versions: [version({ name: 'AR (retired)' })],
      }),
    ];

    const result = resolvePostingAccount(chart, 'AR_CONTROL');

    expect(result.ok).toBe(true);
    expect(result.ok && result.code).toBe('11000');
  });

  it('reports NOT_CONFIGURED for an account with no versions at all', () => {
    const result = resolvePostingAccount(
      [account({ id: 'acc-bare', code: '11000', versions: [] })],
      'AR_CONTROL',
    );

    expect(result).toMatchObject({ ok: false, problem: 'NOT_CONFIGURED' });
  });

  it('reads the latest version, so a re-classified account moves role', () => {
    const reclassified = account({
      id: 'acc-moved',
      code: '11000',
      versions: [
        version({ versionNumber: 1, accountSubtype: 'ACCOUNTS_RECEIVABLE' }),
        version({ versionNumber: 2, accountSubtype: 'OTHER_CURRENT_ASSET' }),
      ],
    });

    expect(resolvePostingAccount([reclassified], 'AR_CONTROL')).toMatchObject({
      ok: false,
      problem: 'NOT_CONFIGURED',
    });
  });
});

describe('resolvePostingAccounts', () => {
  it('resolves every role an invoice post needs', () => {
    const { resolved, problems } = resolvePostingAccounts(seededChart(), [
      'AR_CONTROL',
      'REVENUE',
      'VAT_OUTPUT',
    ]);

    expect(problems).toEqual([]);
    expect(resolved.get('AR_CONTROL')?.code).toBe('11000');
    expect(resolved.get('REVENUE')?.code).toBe('42600');
    expect(resolved.get('VAT_OUTPUT')?.code).toBe('20200');
  });

  it('collects every problem instead of stopping at the first', () => {
    const chart = seededChart().filter((a) => !['20200', '42600'].includes(a.code));

    const { resolved, problems } = resolvePostingAccounts(chart, [
      'AR_CONTROL',
      'REVENUE',
      'VAT_OUTPUT',
    ]);

    expect(resolved.get('AR_CONTROL')?.code).toBe('11000');
    expect(problems.map((p) => p.role)).toEqual(['REVENUE', 'VAT_OUTPUT']);
  });
});

describe('bankAccounts', () => {
  it('returns every bank, because this role is legitimately plural', () => {
    expect(bankAccounts(seededChart()).map((a) => a.code)).toEqual(['10100', '10200']);
  });

  it('sorts by code so the picker order does not shift between renders', () => {
    const chart = [...seededChart()].reverse();

    expect(bankAccounts(chart).map((a) => a.code)).toEqual(['10100', '10200']);
  });

  it('excludes deactivated banks', () => {
    const chart = seededChart().map((a) =>
      a.code === '10200' ? { ...a, status: 'INACTIVE' as const } : a,
    );

    expect(bankAccounts(chart).map((a) => a.code)).toEqual(['10100']);
  });
});
