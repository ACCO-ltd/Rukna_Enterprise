import { journalAccountProblem, journalProblem, reversalDateProblem } from './manual-journal-rules';

const lines = (...pairs: [number, number][]) => pairs.map(([d, c]) => ({ debitAmount: d, creditAmount: c }));
const ok = { accountingDate: '2026-10-28', currencyCode: 'USD', lines: lines([100, 0], [0, 100]) };

describe('manual journal rules (GL-J)', () => {
  it('accepts a balanced journal in the ledger currency', () => {
    expect(journalProblem(ok)).toBeNull();
  });

  it('refuses an impossible date, a reversal not after the journal, and another currency', () => {
    expect(journalProblem({ ...ok, accountingDate: '2026-02-31' })?.errorCode).toBe('JOURNAL_DATE_INVALID');
    expect(journalProblem({ ...ok, documentDate: '2026-13-01' })?.errorCode).toBe('JOURNAL_DATE_INVALID');
    expect(journalProblem({ ...ok, autoReverseOn: '2026-10-28' })?.errorCode).toBe('AUTO_REVERSE_DATE_INVALID');
    expect(journalProblem({ ...ok, autoReverseOn: '2026-11-31' })?.errorCode).toBe('AUTO_REVERSE_DATE_INVALID');
    expect(journalProblem({ ...ok, autoReverseOn: '2026-11-01' })).toBeNull();
    expect(journalProblem({ ...ok, currencyCode: 'EUR' })?.errorCode).toBe('CURRENCY_NOT_SUPPORTED');
  });

  it('refuses lines on both sides or neither, sub-cent amounts, and an unbalanced total', () => {
    expect(journalProblem({ ...ok, lines: lines([100, 0]) })?.errorCode).toBe('JOURNAL_TOO_FEW_LINES');
    expect(journalProblem({ ...ok, lines: lines([5, 5], [0, 0]) })).toMatchObject({ errorCode: 'LINE_ONE_SIDE', line: 1 });
    expect(journalProblem({ ...ok, lines: lines([1.005, 0], [0, 1.005]) })?.errorCode).toBe('AMOUNT_PRECISION');
    expect(journalProblem({ ...ok, lines: lines([0.1, 0], [0.2, 0], [0, 0.3]) })).toBeNull();
    expect(journalProblem({ ...ok, lines: lines([100, 0], [0, 90]) })?.errorCode).toBe('JOURNAL_UNBALANCED');
  });

  it('names why an account cannot take a manual line', () => {
    const acct = { code: '61100', name: 'Office rent', active: true, postingAllowed: true, control: false, systemOnly: false };
    expect(journalAccountProblem(1, acct)).toBeNull();
    expect(journalAccountProblem(2, null)?.errorCode).toBe('ACCOUNT_NOT_FOUND');
    expect(journalAccountProblem(1, { ...acct, active: false })?.errorCode).toBe('ACCOUNT_INACTIVE');
    expect(journalAccountProblem(1, { ...acct, postingAllowed: false })?.errorCode).toBe('ACCOUNT_NOT_POSTABLE');
    expect(journalAccountProblem(1, { ...acct, postingAllowed: false, control: true })?.errorCode).toBe('ACCOUNT_SYSTEM_ONLY');
    expect(journalAccountProblem(1, { ...acct, systemOnly: true })?.errorCode).toBe('ACCOUNT_SYSTEM_ONLY');
  });

  it('dates a reversal on or after the journal', () => {
    const day = new Date('2026-10-20T00:00:00.000Z');
    expect(reversalDateProblem('2026-10-01', day)?.errorCode).toBe('REVERSAL_BEFORE_JOURNAL');
    expect(reversalDateProblem('2026-02-30', day)?.errorCode).toBe('REVERSAL_DATE_INVALID');
    expect(reversalDateProblem('2026-10-20', day)).toBeNull();
  });
});
