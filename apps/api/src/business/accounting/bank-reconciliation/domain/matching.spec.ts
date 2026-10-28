import { Decimal } from '@prisma/client/runtime/library';

import { reconcile, statementAddsUp, suggestMatches } from './matching';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const n = (v: string) => new Decimal(v);

describe('bank reconciliation rules (Step 6)', () => {
  it('suggests the same-amount ledger line dated closest, inside the window', () => {
    const s = suggestMatches(
      [{ id: 's1', transactionDate: d('2026-10-05'), amount: n('-300.00') }, { id: 's2', transactionDate: d('2026-10-06'), amount: n('250.00') }],
      [
        { id: 'l1', accountingDate: d('2026-10-03'), amount: n('-300.00') },
        { id: 'l2', accountingDate: d('2026-09-01'), amount: n('250.00') },
        { id: 'l3', accountingDate: d('2026-10-04'), amount: n('-299.00') },
      ],
    );
    expect(s).toEqual([{ statementLineId: 's1', journalLineId: 'l1', daysApart: 2 }]);
  });

  it('leaves ambiguous cases to a person', () => {
    // Two ledger lines equally close to one statement line.
    expect(suggestMatches(
      [{ id: 's1', transactionDate: d('2026-10-05'), amount: n('100') }],
      [{ id: 'l1', accountingDate: d('2026-10-04'), amount: n('100') }, { id: 'l2', accountingDate: d('2026-10-06'), amount: n('100') }],
    )).toEqual([]);
    // Two identical statement lines both closest to one ledger line.
    expect(suggestMatches(
      [{ id: 's1', transactionDate: d('2026-10-05'), amount: n('100') }, { id: 's2', transactionDate: d('2026-10-05'), amount: n('100') }],
      [{ id: 'l1', accountingDate: d('2026-10-05'), amount: n('100') }],
    )).toEqual([]);
  });

  it('checks the statement adds up', () => {
    expect(statementAddsUp(n('1000'), [n('250'), n('-300')], n('950')).adds).toBe(true);
    expect(statementAddsUp(n('1000'), [n('250')], n('1200')).computedClosing.toFixed(2)).toBe('1250.00');
  });

  it('reconciles the ledger, less what the bank has not seen, to the statement', () => {
    // Ledger 950; a 200 cheque not yet presented; the bank shows 1150.
    const r = reconcile({ ledgerBalance: n('950'), uncleared: [n('-200')], statementClosing: n('1150') });
    expect(r.adjustedLedger.toFixed(2)).toBe('1150.00');
    expect(r.balanced).toBe(true);
    expect(reconcile({ ledgerBalance: n('950'), uncleared: [], statementClosing: n('940') }).difference.toFixed(2)).toBe('-10.00');
  });
});
