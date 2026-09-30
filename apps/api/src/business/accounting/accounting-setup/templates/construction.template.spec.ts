/**
 * ADR-040 — invariants the construction template must respect, for every install-time choice.
 * Pure: the template is data, and these are the rules that make an installed chart postable.
 */
import {
  BANK_BASE_CODE,
  MAX_BANKS,
  RESOLVER_SUBTYPES,
  resolveTemplate,
  type TemplateAccount,
} from './construction.js';
import { buildFiscalYearPlan, fiscalYearName } from '../../accounting-core/domain/fiscal-calendar.js';
import { planVatTaxCodes, vatTaxCode } from '../domain/setup-tax-codes.js';

const banks = (n: number) => Array.from({ length: n }, (_, i) => `Bank ${i + 1}`);

const CHOICES = [
  { vatCharged: false, bankNames: [] as string[] },
  { vatCharged: true, bankNames: [] as string[] },
  { vatCharged: false, bankNames: banks(1) },
  { vatCharged: true, bankNames: banks(3) },
  { vatCharged: true, bankNames: banks(MAX_BANKS) },
];

describe.each(CHOICES)('construction template (VAT=$vatCharged, banks=$bankNames.length)', (choice) => {
  const { accounts, postingProfiles } = resolveTemplate(choice);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const active = accounts; // every template account is created ACTIVE

  it('has exactly one account per resolver role, and no heading carries one', () => {
    for (const subtype of RESOLVER_SUBTYPES) {
      const holders = active.filter((a) => a.accountSubtype === subtype);
      expect({ subtype, count: holders.length }).toEqual({ subtype, count: 1 });
      expect(holders[0]!.isHeading).toBe(false);
    }
  });

  it('has at least one CASH_AND_BANK account (petty cash always) and one per bank', () => {
    const cash = active.filter((a) => a.accountSubtype === 'CASH_AND_BANK');
    expect(cash.length).toBe(1 + choice.bankNames.length);
    expect(byCode.get('10900')?.accountSubtype).toBe('CASH_AND_BANK');
    cash.forEach((a) => expect(a.controlPostingPolicy).toBe('SYSTEM_OR_APPROVED_ADJUSTMENT'));
  });

  it('codes are unique', () => {
    expect(new Set(accounts.map((a) => a.code)).size).toBe(accounts.length);
  });

  it('every parent exists, is a heading, and precedes its child', () => {
    accounts.forEach((a, i) => {
      if (!a.parentCode) return;
      const parentIndex = accounts.findIndex((p) => p.code === a.parentCode);
      expect({ code: a.code, parentIndex: parentIndex >= 0 && parentIndex < i }).toEqual({ code: a.code, parentIndex: true });
      expect(accounts[parentIndex]!.isHeading).toBe(true);
    });
  });

  it('AR and AP are SYSTEM_ONLY control accounts with their subledger; unapplied receipts and supplier advances are SYSTEM_ONLY', () => {
    const ar = byCode.get('11000')!;
    const ap = byCode.get('20000')!;
    expect(ar).toMatchObject({ isControlAccount: true, controlledSubledgerType: 'ACCOUNTS_RECEIVABLE', controlPostingPolicy: 'SYSTEM_ONLY' });
    expect(ap).toMatchObject({ isControlAccount: true, controlledSubledgerType: 'ACCOUNTS_PAYABLE', controlPostingPolicy: 'SYSTEM_ONLY' });
    expect(byCode.get('21100')!.controlPostingPolicy).toBe('SYSTEM_ONLY');
    expect(byCode.get('13000')!.controlPostingPolicy).toBe('SYSTEM_ONLY');
    expect(byCode.get('22000')!.controlPostingPolicy).toBe('SYSTEM_OR_APPROVED_ADJUSTMENT');
    // Only AR and AP are control accounts.
    expect(accounts.filter((a) => a.isControlAccount).map((a) => a.code).sort()).toEqual(['11000', '20000']);
  });

  it('output VAT payable always exists; 14100 input VAT only when VAT is charged', () => {
    expect(byCode.get('22000')?.accountSubtype).toBe('VAT_OUTPUT_PAYABLE');
    expect(byCode.has('14100')).toBe(choice.vatCharged);
    if (choice.vatCharged) expect(byCode.get('14100')!.conditional).toBe('VAT');
  });

  it('banks are 10100, 10101, … under 10000, flagged BANK and named as given', () => {
    choice.bankNames.forEach((name, i) => {
      const a = byCode.get(String(BANK_BASE_CODE + i))!;
      expect(a).toMatchObject({ name, parentCode: '10000', conditional: 'BANK', accountSubtype: 'CASH_AND_BANK' });
    });
  });

  it('32000 current year earnings accepts no postings (the balance sheet computes it; review L5)', () => {
    expect(byCode.get('32000')).toMatchObject({ isPostingAllowed: false, controlPostingPolicy: 'SYSTEM_ONLY', isHeading: false });
    // Only headings, AR/AP and 32000 refuse postings.
    const closed = accounts.filter((a) => !a.isPostingAllowed && !a.isHeading).map((a) => a.code).sort();
    expect(closed).toEqual(['11000', '20000', '32000']);
  });

  it('carries no retention or guarantee accounts', () => {
    expect(accounts.filter((a) => /retention|guarantee/i.test(a.name))).toEqual([]);
  });

  it('normal balances follow the class (accumulated depreciation is a credit contra-asset)', () => {
    const credit = (a: TemplateAccount) => ['LIABILITY', 'EQUITY', 'INCOME'].includes(a.accountClass) || a.accountSubtype === 'ACCUMULATED_DEPRECIATION';
    accounts.forEach((a) => expect({ code: a.code, nb: a.normalBalance }).toEqual({ code: a.code, nb: credit(a) ? 'CREDIT' : 'DEBIT' }));
  });

  it('one posting profile per posting INCOME / COST_OF_SALES / EXPENSE account; PROJECT_REVENUE → 40000', () => {
    const posting = accounts.filter((a) => !a.isHeading && ['INCOME', 'COST_OF_SALES', 'EXPENSE'].includes(a.accountClass));
    expect(postingProfiles.map((p) => p.accountCode).sort()).toEqual(posting.map((a) => a.code).sort());
    expect(postingProfiles.find((p) => p.code === 'PROJECT_REVENUE')?.accountCode).toBe('40000');
    expect(postingProfiles.find((p) => p.accountCode === '51100')).toEqual({ code: 'COST_51100', name: 'Cement and concrete', accountCode: '51100' });
    expect(postingProfiles.find((p) => p.accountCode === '61100')?.code).toBe('EXP_61100');
    expect(postingProfiles.find((p) => p.accountCode === '42100')?.code).toBe('INC_42100');
    expect(new Set(postingProfiles.map((p) => p.code)).size).toBe(postingProfiles.length);
    postingProfiles.forEach((p) => expect(p.code).toMatch(/^[A-Z0-9_]{1,50}$/));
  });
});

describe('construction template — shape', () => {
  it('lists exactly the ADR-040 chart codes (78 without VAT or banks; 14100 with VAT)', () => {
    const ADR_040_CODES = [
    '10000', '10900', '11000', '12000', '13000', '13100', '13200', '14000', '14100', '15000',
    '15100', '15200', '15300', '15400', '15500', '15900', '20000', '21000', '21100', '22000',
    '23000', '23100', '23200', '23300', '24000', '30000', '31000', '32000', '33000', '40000',
    '42000', '42100', '42200', '42900', '51000', '51100', '51200', '51300', '51400', '51500',
    '51600', '51700', '51900', '52000', '52100', '52200', '52300', '53000', '53100', '53200',
    '54000', '54100', '54200', '54300', '55000', '55100', '55200', '55300', '55400', '55500',
    '55900', '60000', '61000', '61100', '61200', '61300', '61400', '61500', '61600', '61700',
    '61800', '61900', '62000', '62900', '65000', '66000', '66100', '66200', '69000',
    ];
    const withVat = resolveTemplate({ vatCharged: true, bankNames: [] }).accounts.map((a) => a.code);
    expect([...withVat].sort()).toEqual([...ADR_040_CODES].sort());
    expect(resolveTemplate({ vatCharged: false, bankNames: [] }).accounts).toHaveLength(78);
  });

  it('rejects more than MAX_BANKS banks', () => {
    expect(() => resolveTemplate({ vatCharged: false, bankNames: banks(MAX_BANKS + 1) })).toThrow(RangeError);
  });

  it('the last possible bank code stays inside 101xx and never collides with petty cash', () => {
    const { accounts } = resolveTemplate({ vatCharged: false, bankNames: banks(MAX_BANKS) });
    const last = String(BANK_BASE_CODE + MAX_BANKS - 1);
    expect(last).toBe('10119');
    expect(accounts.find((a) => a.code === last)?.conditional).toBe('BANK');
  });
});

describe('fiscal calendar', () => {
  it('a calendar year: FY2026, 1 Jan – 31 Dec, twelve OPEN periods', () => {
    const plan = buildFiscalYearPlan(2026, 1);
    expect(plan.name).toBe('FY2026');
    expect(plan.startDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(plan.endDate.toISOString().slice(0, 10)).toBe('2026-12-31');
    expect(plan.periods).toHaveLength(12);
    expect(plan.periods.every((p) => p.status === 'OPEN')).toBe(true);
    expect(plan.periods[1]!.endDate.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('a non-January start runs into the next year: FY2026/27, 1 Apr 2026 – 31 Mar 2027', () => {
    const plan = buildFiscalYearPlan(2026, 4);
    expect(plan.name).toBe('FY2026/27');
    expect(plan.startDate.toISOString().slice(0, 10)).toBe('2026-04-01');
    expect(plan.endDate.toISOString().slice(0, 10)).toBe('2027-03-31');
    expect(plan.periods[0]!.name).toBe('April 2026');
    expect(plan.periods[9]!.name).toBe('January 2027');
    expect(plan.periods[10]!.endDate.toISOString().slice(0, 10)).toBe('2027-02-28');
    // Contiguous: each period starts the day after the previous one ends.
    for (let i = 1; i < 12; i++) {
      const gap = plan.periods[i]!.startDate.getTime() - plan.periods[i - 1]!.endDate.getTime();
      expect(gap).toBe(24 * 3600 * 1000);
    }
  });

  it('a leap February and a century year name', () => {
    expect(buildFiscalYearPlan(2028, 1).periods[1]!.endDate.toISOString().slice(0, 10)).toBe('2028-02-29');
    expect(fiscalYearName(2099, 7)).toBe('FY2099/00');
  });

  it('rejects a month outside 1..12', () => {
    expect(() => buildFiscalYearPlan(2026, 13)).toThrow(RangeError);
  });
});

describe('VAT tax codes', () => {
  it('VAT{rate}_OUT / VAT{rate}_IN within the 10-character column', () => {
    expect(planVatTaxCodes(5).map((c) => [c.code, c.recoveryMethod])).toEqual([
      ['VAT5_OUT', 'FULLY_RECOVERABLE'],
      ['VAT5_IN', 'NON_RECOVERABLE'],
    ]);
    expect(vatTaxCode(100, 'OUTPUT')).toBe('VAT100_OUT');
    expect(vatTaxCode(7.5, 'OUTPUT')).toBe('VAT7.5_OUT');
    expect(vatTaxCode(12.5, 'OUTPUT')).toBe('VAT12.5_O');
    expect(vatTaxCode(12.25, 'INPUT')).toBe('VAT12.25_I');
    for (const r of [0.01, 5, 12.25, 99.99, 100]) {
      expect(vatTaxCode(r, 'OUTPUT').length).toBeLessThanOrEqual(10);
      expect(vatTaxCode(r, 'INPUT').length).toBeLessThanOrEqual(10);
    }
  });
});
