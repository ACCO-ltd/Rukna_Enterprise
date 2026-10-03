import { Decimal } from '@prisma/client/runtime/library';
import type { FinancePortfolioRow } from '@erp/types';

import { inQueue, matchesSearch, portfolioTotals, queueCounts } from './finance-portfolio.policy';

function row(over: Partial<FinancePortfolioRow> = {}): FinancePortfolioRow {
  return {
    projectId: 'p',
    code: 'ACC-01',
    name: 'Clinic',
    clientName: 'Hodan',
    status: 'ACTIVE',
    currency: 'USD',
    contractValue: '100.00',
    billed: '50.00',
    collected: '20.00',
    outstanding: '30.00',
    overdue: '0.00',
    costToDate: '10.00',
    committedCost: '15.00',
    margin: 40,
    readyToBill: { count: 0, amount: '0.00' },
    overdueInvoices: { count: 0, oldestDaysPastDue: null },
    billsToPay: { count: 0, amount: '0.00' },
    ...over,
  };
}

describe('finance portfolio policy', () => {
  it('places a row in each queue by its own count', () => {
    const r = row({ readyToBill: { count: 1, amount: '5.00' }, billsToPay: { count: 2, amount: '9.00' } });
    expect(inQueue(r, 'TO_BILL')).toBe(true);
    expect(inQueue(r, 'OVERDUE')).toBe(false);
    expect(inQueue(r, 'TO_PAY')).toBe(true);
    expect(queueCounts([r, row()])).toEqual({ ALL: 2, TO_BILL: 1, OVERDUE: 0, TO_PAY: 1 });
  });

  it('sums visible rows, bills once each, flags mixed currencies', () => {
    const t = portfolioTotals(
      [row(), row({ currency: 'SOS', billed: '25.00' })],
      { distinctCount: 3, distinctAmount: new Decimal(12) },
      true,
    );
    expect(t.billed).toBe('75.00');
    expect(t.contractValue).toBe('200.00');
    expect(t.currency).toBeNull();
    expect(t.mixedCurrencies).toBe(true);
    expect(t.billsToPay).toEqual({ count: 3, amount: '12.00' });
  });

  it('hides every money total when money is hidden', () => {
    const t = portfolioTotals([row()], { distinctCount: 1, distinctAmount: new Decimal(5) }, false);
    expect(t.billed).toBeNull();
    expect(t.billsToPay).toEqual({ count: 1, amount: null });
  });

  it('searches code, name and client case-insensitively', () => {
    expect(matchesSearch(row(), 'acc-01')).toBe(true);
    expect(matchesSearch(row(), 'CLINIC')).toBe(true);
    expect(matchesSearch(row(), 'hodan')).toBe(true);
    expect(matchesSearch(row(), 'school')).toBe(false);
    expect(matchesSearch(row(), '  ')).toBe(true);
  });
});
