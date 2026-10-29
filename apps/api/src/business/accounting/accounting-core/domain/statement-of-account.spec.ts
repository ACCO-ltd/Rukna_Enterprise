import { Decimal } from '@prisma/client/runtime/library';

import { buildStatementLines, type StatementMovement } from './statement-of-account';

const d = (s: string) => new Date(`${s}T00:00:00.000Z`);
const m = (date: string, debit: number, credit: number, kind = 'X'): StatementMovement =>
  ({ date: d(date), kind, documentId: date + kind, reference: null, description: null, debit: new Decimal(debit), credit: new Decimal(credit), sequence: 0 });

describe('buildStatementLines — credit-normal (supplier) accounts (AP-3)', () => {
  it('runs the balance as credits − debits, folding earlier movements into the opening', () => {
    const r = buildStatementLines([m('2026-01-05', 0, 1000, 'BILL'), m('2026-02-01', 700, 0, 'PAYMENT'), m('2026-02-10', 0, 250, 'BILL')], d('2026-02-01'), d('2026-02-28'), { creditNormal: true });
    expect(r.opening.toFixed(2)).toBe('1000.00');
    expect(r.lines.map((l) => l.balance)).toEqual(['300.00', '550.00']);
    expect(r.closing.toFixed(2)).toBe('550.00');
  });
});
