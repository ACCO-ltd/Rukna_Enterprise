import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import {
  MAX_SETUP_BANKS,
  buildChartPreview,
  emptyBankDraft,
  fiscalYearName,
  fiscalYearRange,
  hasSetupProblems,
  initialSetupDraft,
  existingRecordsList,
  setupConflict,
  previewAccountCount,
  setupProblems,
  toSetupBody,
  type SetupDraft,
  type SetupTemplate,
  type SetupTemplateAccount,
} from './accounting-setup';

function row(overrides: Partial<SetupTemplateAccount> & { code: string }): SetupTemplateAccount {
  return {
    name: `Account ${overrides.code}`,
    accountClass: 'ASSET',
    accountSubtype: 'OTHER_CURRENT_ASSET',
    normalBalance: 'DEBIT',
    isHeading: false,
    parentCode: null,
    isControlAccount: false,
    ...overrides,
  };
}

const TEMPLATE: SetupTemplate = {
  templateId: 'CONSTRUCTION',
  version: '1.0.0',
  accounts: [
    row({ code: '10000', name: 'Current assets', isHeading: true }),
    row({ code: '10100', name: 'Bank 1', parentCode: '10000', conditional: 'BANK' }),
    row({ code: '10110', name: 'Bank 2', parentCode: '10000', conditional: 'BANK' }),
    row({ code: '10900', name: 'Petty cash', parentCode: '10000' }),
    row({
      code: '20000',
      name: 'Accounts payable',
      accountClass: 'LIABILITY',
      normalBalance: 'CREDIT',
      isControlAccount: true,
    }),
    row({ code: '51000', name: 'Materials', accountClass: 'COST_OF_SALES', isHeading: true }),
    row({
      code: '51100',
      name: 'Cement and concrete',
      accountClass: 'COST_OF_SALES',
      parentCode: '51000',
    }),
  ],
  postingProfiles: [{ code: 'COST_51100', name: 'Cement and concrete', accountCode: '51100' }],
};

function draft(overrides: Partial<SetupDraft> = {}): SetupDraft {
  return {
    banks: [
      { key: 'b1', accountName: 'Main operating', bankName: 'Salaam Bank', accountNumber: '' },
    ],
    year: '2026',
    startMonth: 1,
    ...overrides,
  };
}

describe('setupProblems', () => {
  it('starts this year, in January, with one bank row', () => {
    const initial = initialSetupDraft(new Date(2026, 8, 30));
    expect(initial.year).toBe('2026');
    expect(initial.startMonth).toBe(1);
    expect(initial.banks).toHaveLength(1);
  });

  it('names the missing fields of each bank row', () => {
    const problems = setupProblems(
      draft({
        banks: [
          { key: 'a', accountName: '', bankName: '  ', accountNumber: '' },
          { key: 'b', accountName: 'Ops', bankName: 'Dahabshiil', accountNumber: '' },
        ],
      }),
    );
    expect(problems.banks).toEqual({ a: ['accountName', 'bankName'] });
    expect(hasSetupProblems(problems)).toBe(true);
  });

  it('allows no banks at all, and refuses more than the maximum', () => {
    expect(hasSetupProblems(setupProblems(draft({ banks: [] })))).toBe(false);
    const many = Array.from({ length: MAX_SETUP_BANKS + 1 }, (_, i) => ({
      ...emptyBankDraft(),
      accountName: `A${i}`,
      bankName: 'B',
    }));
    expect(setupProblems(draft({ banks: many })).tooManyBanks).toBe(true);
  });

  it('refuses a year outside 2000–2100', () => {
    expect(setupProblems(draft({ year: '1999' })).year).toBe(true);
    expect(setupProblems(draft({ year: '26' })).year).toBe(true);
    expect(setupProblems(draft({ year: '2030' })).year).toBe(false);
  });
});

describe('toSetupBody', () => {
  it('omits an empty account number', () => {
    expect(
      toSetupBody(
        draft({
          banks: [
            { key: 'a', accountName: ' Main ', bankName: 'Salaam Bank', accountNumber: '' },
            { key: 'b', accountName: 'Payroll', bankName: 'Premier', accountNumber: ' 0042 ' },
          ],
          year: '2027',
          startMonth: 7,
        }),
      ),
    ).toEqual({
      templateId: 'CONSTRUCTION',
      banks: [
        { accountName: 'Main', bankName: 'Salaam Bank' },
        { accountName: 'Payroll', bankName: 'Premier', accountNumber: '0042' },
      ],
      fiscalYear: { year: 2027, startMonth: 7 },
    });
  });
});

describe('fiscalYearRange', () => {
  it('covers twelve months from the start month', () => {
    expect(fiscalYearRange(2026, 1)).toEqual({ start: 'January 2026', end: 'December 2026' });
    expect(fiscalYearRange(2026, 7)).toEqual({ start: 'July 2026', end: 'June 2027' });
  });
});

describe('fiscalYearName', () => {
  it('matches the API: FY2026 for January, FY2026/27 otherwise', () => {
    expect(fiscalYearName(2026, 1)).toBe('FY2026');
    expect(fiscalYearName(2026, 7)).toBe('FY2026/27');
    expect(fiscalYearName(2099, 4)).toBe('FY2099/00');
  });
});

describe('buildChartPreview', () => {
  it('keeps every template row', () => {
    expect(previewAccountCount(buildChartPreview(TEMPLATE, { bankNames: [] }))).toBe(TEMPLATE.accounts.length);
  });

  it('names bank rows after the banks typed, in order', () => {
    const groups = buildChartPreview(TEMPLATE, { bankNames: ['Main operating', 'Payroll'] });
    const names = groups[0]!.rows.map((r) => r.displayName);
    expect(names).toEqual(['Current assets', 'Main operating', 'Payroll', 'Petty cash']);
  });

  it('groups by class in ledger order and indents children under their parent', () => {
    const groups = buildChartPreview(TEMPLATE, { bankNames: [] });
    expect(groups.map((g) => g.accountClass)).toEqual(['ASSET', 'LIABILITY', 'COST_OF_SALES']);
    const materials = groups[2]!.rows;
    expect(materials.map((r) => [r.account.code, r.depth])).toEqual([
      ['51000', 0],
      ['51100', 1],
    ]);
  });
});

describe('setupConflict', () => {
  it('recognises the already-set-up 409 however the code is carried', () => {
    expect(setupConflict(new ApiError(409, 'Accounting is already set up'))).toEqual({
      kind: 'already',
    });
    expect(setupConflict(new ApiError(400, 'x', 'ACCOUNTING_ALREADY_SET_UP'))).toEqual({
      kind: 'already',
    });
    expect(setupConflict(new ApiError(400, 'Bad request'))).toBeNull();
    expect(setupConflict(null)).toBeNull();
  });

  it('tells a partial setup apart, with the records that block it', () => {
    expect(
      setupConflict(
        new ApiError(409, 'Partially set up', 'ACCOUNTING_PARTIALLY_SET_UP', [], {
          existingRecords: ['POSTING_PROFILES', 'BANK_ACCOUNTS'],
        }),
      ),
    ).toEqual({ kind: 'partial', existingRecords: ['POSTING_PROFILES', 'BANK_ACCOUNTS'] });
  });

  it('lists the records in plain words', () => {
    const label = (r: string) => r.toLowerCase().replace('_', ' ');
    expect(existingRecordsList(['BANK_ACCOUNTS'], label)).toBe('bank accounts');
    expect(existingRecordsList(['POSTING_PROFILES', 'BANK_ACCOUNTS', 'FISCAL_YEARS'], label)).toBe(
      'posting profiles, bank accounts, and fiscal years',
    );
  });
});
