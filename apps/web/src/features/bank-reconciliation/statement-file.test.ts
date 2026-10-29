import { describe, expect, it } from 'vitest';

import { columnsReady, guessStatementColumns, readDate, readMoney, readStatement } from './statement-file';

describe('statement file (Step 6)', () => {
  it('matches the usual bank headers, signed or split', () => {
    expect(guessStatementColumns(['Date', 'Details', 'Ref', 'Amount'])).toMatchObject({ date: 0, description: 1, reference: 2, amount: 3, moneyIn: null, moneyOut: null });
    const split = guessStatementColumns(['Value Date', 'Narrative', 'Debit', 'Credit', 'Balance']);
    expect(split).toMatchObject({ date: 0, description: 1, moneyOut: 2, moneyIn: 3 });
    expect(columnsReady(split)).toBe(true);
    expect(columnsReady({ date: 0, description: 1, moneyIn: 2 })).toBe(false);
  });

  it('reads dates in the chosen order and refuses impossible ones', () => {
    expect(readDate('2026-10-05', 'MDY')).toBe('2026-10-05');
    expect(readDate('05/10/2026', 'DMY')).toBe('2026-10-05');
    expect(readDate('10/05/26', 'MDY')).toBe('2026-10-05');
    expect(readDate('31/02/2026', 'DMY')).toBeNull();
  });

  it('reads money the way statements write it', () => {
    expect(readMoney('1,234.50')).toBe(123450);
    expect(readMoney('(75.00)')).toBe(-7500);
    expect(readMoney('USD 12.5')).toBe(1250);
    expect(readMoney('')).toBe(0);
    expect(readMoney('abc')).toBeNull();
  });

  it('turns split columns into signed lines and names the rows it cannot read', () => {
    const read = readStatement(
      [
        ['01/10/2026', 'Transfer in', '', '1,000.00'],
        ['03/10/2026', 'Payment out', '300.00', ''],
        ['', '', '', ''],
        ['xx', 'Bad date', '1', ''],
      ],
      { date: 0, description: 1, moneyOut: 2, moneyIn: 3 },
      'DMY',
    );
    expect(read.lines).toEqual([
      { transactionDate: '2026-10-01', description: 'Transfer in', amount: '1000.00' },
      { transactionDate: '2026-10-03', description: 'Payment out', amount: '-300.00' },
    ]);
    expect(read.problems).toEqual([{ line: 5, problem: 'date' }]);
    expect(read.netMinor).toBe(70000);
    expect([read.firstDate, read.lastDate]).toEqual(['2026-10-01', '2026-10-03']);
  });
});
