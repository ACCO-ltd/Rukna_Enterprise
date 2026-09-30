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
  parseVatRate,
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
    row({ code: '14100', name: 'Input VAT recoverable', parentCode: '10000', conditional: 'VAT' }),
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
    vatMode: 'none',
    vatRate: '',
    banks: [
      { key: 'b1', accountName: 'Main operating', bankName: 'Salaam Bank', accountNumber: '' },
    ],
    year: '2026',
    startMonth: 1,
    ...overrides,
  };
}

describe('parseVatRate', () => {
  it.each([
    ['5', 5],
    ['15.5', 15.5],
    ['100', 100],
    [' 7.25 ', 7.25],
  ])('accepts %s', (raw, expected) => {
    expect(parseVatRate(raw)).toBe(expected);
  });

  it.each(['', '0', '0.00', '100.01', '150', '-5', 'abc', '5.123', '5,5'])('refuses %s', (raw) => {
    expect(parseVatRate(raw)).toBeNull();
  });
});

describe('setupProblems', () => {
  it('asks for a VAT decision rather than defaulting one', () => {
    const initial = initialSetupDraft(new Date(2026, 8, 30));
    expect(initial.vatMode).toBe('');
    expect(initial.year).toBe('2026');
    expect(initial.startMonth).toBe(1);
    expect(setupProblems(initial).vatChoice).toBe(true);
  });

  it('requires a valid rate only when VAT is charged', () => {
    expect(setupProblems(draft({ vatMode: 'none', vatRate: 'x' })).vatRate).toBe(false);
    expect(setupProblems(draft({ vatMode: 'charged', vatRate: '0' })).vatRate).toBe(true);
    expect(setupProblems(draft({ vatMode: 'charged', vatRate: '5' })).vatRate).toBe(false);
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
  it('sends the rate when VAT is charged and omits an empty account number', () => {
    expect(
      toSetupBody(
        draft({
          vatMode: 'charged',
          vatRate: '5',
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
      vat: { charged: true, ratePercent: 5 },
      banks: [
        { accountName: 'Main', bankName: 'Salaam Bank' },
        { accountName: 'Payroll', bankName: 'Premier', accountNumber: '0042' },
      ],
      fiscalYear: { year: 2027, startMonth: 7 },
    });
  });

  it('sends no rate when VAT is not charged', () => {
    expect(toSetupBody(draft({ vatMode: 'none', vatRate: '5' })).vat).toEqual({ charged: false });
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
  it('drops VAT rows when VAT is not charged, and keeps them when it is', () => {
    const without = buildChartPreview(TEMPLATE, { vatCharged: false, bankNames: [] });
    const withVat = buildChartPreview(TEMPLATE, { vatCharged: true, bankNames: [] });
    const codes = (groups: typeof without) =>
      groups.flatMap((g) => g.rows.map((r) => r.account.code));
    expect(codes(without)).not.toContain('14100');
    expect(codes(withVat)).toContain('14100');
    expect(previewAccountCount(withVat)).toBe(previewAccountCount(without) + 1);
  });

  it('names bank rows after the banks typed, in order', () => {
    const groups = buildChartPreview(TEMPLATE, {
      vatCharged: false,
      bankNames: ['Main operating', 'Payroll'],
    });
    const names = groups[0]!.rows.map((r) => r.displayName);
    expect(names).toEqual(['Current assets', 'Main operating', 'Payroll', 'Petty cash']);
  });

  it('groups by class in ledger order and indents children under their parent', () => {
    const groups = buildChartPreview(TEMPLATE, { vatCharged: false, bankNames: [] });
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
          existingRecords: ['TAX_CODES', 'BANK_ACCOUNTS'],
        }),
      ),
    ).toEqual({ kind: 'partial', existingRecords: ['TAX_CODES', 'BANK_ACCOUNTS'] });
  });

  it('lists the records in plain words', () => {
    const label = (r: string) => r.toLowerCase().replace('_', ' ');
    expect(existingRecordsList(['TAX_CODES'], label)).toBe('tax codes');
    expect(existingRecordsList(['TAX_CODES', 'BANK_ACCOUNTS', 'FISCAL_YEARS'], label)).toBe(
      'tax codes, bank accounts, and fiscal years',
    );
  });
});
