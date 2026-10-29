import { Decimal } from '@prisma/client/runtime/library';

import { ageOpenItems, buildStatementLines, type StatementMovement } from './client-statement';

const m = (date: string, kind: StatementMovement['kind'], debit: string, credit: string, sequence = 0): StatementMovement => ({
  date: new Date(`${date}T00:00:00.000Z`),
  kind,
  documentId: `${kind}-${date}`,
  reference: null,
  description: null,
  debit: new Decimal(debit),
  credit: new Decimal(credit),
  sequence,
});

describe('buildStatementLines (AR-3)', () => {
  it('folds earlier movements into the opening balance, runs the period, leaves later ones out', () => {
    const r = buildStatementLines(
      [
        m('2026-01-10', 'INVOICE', '1000', '0'),
        m('2026-02-05', 'RECEIPT', '0', '400', 4),
        m('2026-02-05', 'INVOICE', '200', '0'),
        m('2026-02-20', 'CREDIT_NOTE', '0', '50', 2),
        m('2026-03-01', 'RECEIPT', '0', '700', 4),
      ],
      new Date('2026-02-01T00:00:00Z'),
      new Date('2026-02-28T00:00:00Z'),
    );
    expect(r.opening.toFixed(2)).toBe('1000.00');
    // Same day: the invoice before the receipt.
    expect(r.lines.map((l) => [l.kind, l.balance])).toEqual([
      ['INVOICE', '1200.00'],
      ['RECEIPT', '800.00'],
      ['CREDIT_NOTE', '750.00'],
    ]);
    expect(r.closing.toFixed(2)).toBe('750.00');
    expect([r.debits.toFixed(2), r.credits.toFixed(2)]).toEqual(['200.00', '450.00']);
  });

  it('an empty period keeps the opening balance as the closing balance', () => {
    const r = buildStatementLines([m('2026-01-10', 'INVOICE', '300', '0')], new Date('2026-05-01T00:00:00Z'), new Date('2026-05-31T00:00:00Z'));
    expect(r.lines).toEqual([]);
    expect(r.closing.toFixed(2)).toBe('300.00');
  });
});

describe('ageOpenItems', () => {
  it('buckets by days past due; no due date is current; settled items are skipped', () => {
    const asOf = new Date('2026-06-30T00:00:00Z');
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    expect(
      ageOpenItems(
        [
          { dueDate: d('2026-07-10'), outstanding: new Decimal(100) },
          { dueDate: null, outstanding: new Decimal(5) },
          { dueDate: d('2026-06-15'), outstanding: new Decimal(20) },
          { dueDate: d('2026-05-15'), outstanding: new Decimal(30) },
          { dueDate: d('2026-04-15'), outstanding: new Decimal(40) },
          { dueDate: d('2026-01-15'), outstanding: new Decimal(50) },
          { dueDate: d('2026-01-15'), outstanding: new Decimal(0) },
        ],
        asOf,
      ),
    ).toEqual({ current: '105.00', d1_30: '20.00', d31_60: '30.00', d61_90: '40.00', d90_plus: '50.00' });
  });
});
