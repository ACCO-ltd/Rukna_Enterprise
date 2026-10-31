import { billProblem, reversalDateProblem } from './supplier-bill-rules';

const bill = (over: Partial<Parameters<typeof billProblem>[0]> = {}) => ({
  currencyCode: 'USD',
  billDate: '2026-10-01',
  dueDate: '2026-10-31',
  lines: [{ netAmount: 100 }],
  ...over,
});

describe('supplier bill rules (SB-1)', () => {
  it('accepts a plain USD bill', () => {
    expect(billProblem(bill())).toBeNull();
  });

  it('names each mistake', () => {
    expect(billProblem(bill({ currencyCode: 'EUR' }))?.errorCode).toBe('CURRENCY_NOT_SUPPORTED');
    expect(billProblem(bill({ dueDate: '2026-09-30' }))?.errorCode).toBe('DUE_BEFORE_BILL_DATE');
    expect(billProblem(bill({ lines: [{ netAmount: 0 }] }))?.errorCode).toBe('BILL_TOTAL_NOT_POSITIVE');
  });

  it('a line amount typed over quantity × price is kept, as the supplier charged it', () => {
    expect(billProblem(bill({ lines: [{ quantity: 2, unitPrice: 10, netAmount: 25 } as never] }))).toBeNull();
  });

  it('a due date on the bill date is fine', () => {
    expect(billProblem(bill({ dueDate: '2026-10-01T00:00:00.000Z' }))).toBeNull();
  });

  it('a reversal cannot predate its bill', () => {
    const billDate = new Date('2026-10-10T00:00:00.000Z');
    expect(reversalDateProblem(billDate, '2026-10-09')?.errorCode).toBe('REVERSAL_BEFORE_BILL');
    expect(reversalDateProblem(billDate, '2026-10-10')).toBeNull();
  });
});
