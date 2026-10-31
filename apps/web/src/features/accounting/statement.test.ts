import { describe, expect, it } from 'vitest';

import { asOfDate, reportRange, statementSections } from './statement';
import type { Account } from './types';

function account(id: string, code: string, name: string, accountClass: string, parent: string | null = null, heading = false): Account {
  return {
    id, code, status: 'ACTIVE', normalBalance: 'DEBIT',
    versions: [{ versionNumber: 1, name, accountClass, accountSubtype: 'OTHER', parentAccountId: parent, isPostingAllowed: !heading, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: '2026-01-01', effectiveTo: null }],
  } as never;
}

describe('statementSections', () => {
  const chart = [
    account('h', '60000', 'Admin', 'EXPENSE', null, true),
    account('a', '61000', 'Rent', 'EXPENSE', 'h'),
    account('b', '62000', 'Power', 'EXPENSE', 'h'),
    account('i', '42100', 'Hire', 'INCOME'),
  ];

  it('rolls sub-accounts into their heading and drops accounts with nothing', () => {
    const [income, expense] = statementSections(chart, [new Map([['a', '100.00'], ['i', '500.00']])], ['INCOME', 'EXPENSE']);
    expect(income!.lines.map((l) => [l.code, l.amounts[0]])).toEqual([['42100', 50000]]);
    expect(expense!.lines.map((l) => [l.code, l.depth, l.amounts[0]])).toEqual([['60000', 0, 10000], ['61000', 1, 10000]]);
    expect(expense!.totals).toEqual([10000]);
  });

  it('keeps an account when any column carries a figure', () => {
    const [, expense] = statementSections(chart, [new Map([['a', '100.00']]), new Map([['b', '40.00']])], ['INCOME', 'EXPENSE']);
    expect(expense!.lines.map((l) => [l.code, l.amounts])).toEqual([['60000', [10000, 4000]], ['61000', [10000, 0]], ['62000', [0, 4000]]]);
  });

  it('places an account the chart does not list where the report says, under its own name', () => {
    const [income] = statementSections(chart, [new Map([['x', '9.00']])], ['INCOME', 'EXPENSE'], new Map([['x', { accountClass: 'INCOME' as const, code: '49000', name: 'Sundry' }]]));
    expect(income!.lines.map((l) => [l.code, l.name])).toEqual([['49000', 'Sundry']]);
    expect(income!.totals).toEqual([900]);
  });
});

describe('report dates', () => {
  it('works out calendar periods from today', () => {
    expect(reportRange('month', '2026-10-31')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(reportRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(reportRange('quarter', '2026-11-02')).toEqual({ from: '2026-10-01', to: '2026-12-31' });
    expect(reportRange('lastYear', '2026-05-05')).toEqual({ from: '2025-01-01', to: '2025-12-31' });
    expect(asOfDate('endLastMonth', '2026-03-10')).toBe('2026-02-28');
    expect(asOfDate('endLastYear', '2026-03-10')).toBe('2025-12-31');
  });
});
