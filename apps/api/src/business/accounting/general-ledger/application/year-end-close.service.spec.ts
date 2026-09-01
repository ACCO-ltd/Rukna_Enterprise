/**
 * YE1 — Year-end net-P&L sign + retained-earnings transfer.
 *
 * The closing journal must (a) zero every temporary income-statement account and
 * (b) transfer the EXACT net result to retained earnings with the correct direction:
 *   profit ⇒ RE increases (credit RE); loss ⇒ RE decreases (debit RE).
 *
 * These are pure unit tests: prisma and the posting port are mocked, so no DB is
 * needed. The fake posting port captures the closing lines the service builds, which
 * is exactly the surface the sign bug lived on.
 */
import { ConflictException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import { YearEndCloseService } from './year-end-close.service.js';

const RE_ACCOUNT = 'acc-retained-earnings';
const PERIOD_END = new Date('2025-12-31');

type Bal = { debit: number; credit: number };

/** One P&L account and its aggregated posted balance for the year. */
interface PLAccountFixture {
  id: string;
  accountClass: 'INCOME' | 'EXPENSE' | 'COST_OF_SALES';
  balance: Bal;
}

interface CapturedPost {
  command: {
    accountingDate: Date;
    lines: Array<{ accountId: string; debitAmount?: Decimal; creditAmount?: Decimal }>;
  };
}

function build(
  plAccounts: PLAccountFixture[],
  opts: { existingClose?: boolean } = {},
) {
  const captured: CapturedPost[] = [];

  const periods = Array.from({ length: 12 }, (_, i) => ({
    id: `p${i + 1}`,
    periodNumber: i + 1,
    name: `Period ${i + 1}`,
    status: i + 1 === 12 ? 'LOCKED' : 'CLOSED',
    endDate: PERIOD_END,
  }));

  const balanceByAccount = new Map(plAccounts.map((a) => [a.id, a.balance]));

  const prisma = {
    fiscalYear: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'fy1',
        name: 'FY2025',
        status: 'OPEN',
        organizationId: 'o1',
        retainedEarningsAccountId: RE_ACCOUNT,
        periods,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    journalEntry: {
      findFirst: jest.fn().mockResolvedValue(opts.existingClose ? { id: 'je-existing', journalNumber: 'JE-CLOSE-1' } : null),
    },
    account: {
      findMany: jest.fn().mockResolvedValue(
        plAccounts.map((a) => ({
          id: a.id,
          versions: [{ accountClass: a.accountClass }],
        })),
      ),
    },
    journalLine: {
      aggregate: jest.fn().mockImplementation(({ where }: { where: { accountId: string } }) => {
        const bal = balanceByAccount.get(where.accountId) ?? { debit: 0, credit: 0 };
        return Promise.resolve({
          _sum: {
            debitAmount: new Decimal(bal.debit),
            creditAmount: new Decimal(bal.credit),
          },
        });
      }),
    },
    accountingPeriod: { update: jest.fn().mockResolvedValue({}) },
    $transaction: jest.fn().mockImplementation((fn: (tx: unknown) => unknown) => fn({})),
  };

  const tenancy = { getClient: () => prisma } as never;
  const snapshotService = {
    generateForPeriod: jest.fn().mockResolvedValue({ accountsSnapshotted: plAccounts.length }),
  } as never;
  const postingPort = {
    post: jest.fn().mockImplementation((command: CapturedPost['command']) => {
      captured.push({ command });
      return Promise.resolve({ journalEntryId: 'je-close', journalNumber: 'JE-CLOSE-1' });
    }),
  } as never;

  const svc = new YearEndCloseService(tenancy, snapshotService, {} as never, postingPort);
  const identity = { userId: 'u1', activeOrganizationId: 'o1' } as never;

  return { svc, identity, captured, prisma, snapshotService };
}

/** The line posted against the retained-earnings account, if any. */
function reLine(captured: CapturedPost[]) {
  return captured[0]?.command.lines.find((l) => l.accountId === RE_ACCOUNT);
}

/** Signed RE movement: +credit (increase) or −debit (decrease). */
function reSignedMovement(captured: CapturedPost[]): number {
  const line = reLine(captured);
  if (!line) return 0;
  const credit = line.creditAmount ? Number(line.creditAmount) : 0;
  const debit = line.debitAmount ? Number(line.debitAmount) : 0;
  return credit - debit;
}

/** Assert the closing journal balances: ∑debits === ∑credits. */
function expectBalanced(captured: CapturedPost[]) {
  const lines = captured[0].command.lines;
  const debits = lines.reduce((s, l) => s + (l.debitAmount ? Number(l.debitAmount) : 0), 0);
  const credits = lines.reduce((s, l) => s + (l.creditAmount ? Number(l.creditAmount) : 0), 0);
  expect(debits).toBeCloseTo(credits, 6);
}

// A revenue account with N posted is credit-heavy: credit N, debit 0.
const revenue = (id: string, amount: number): PLAccountFixture => ({
  id,
  accountClass: 'INCOME',
  balance: { debit: 0, credit: amount },
});
// An expense account with N posted is debit-heavy: debit N, credit 0.
const expense = (id: string, amount: number): PLAccountFixture => ({
  id,
  accountClass: 'EXPENSE',
  balance: { debit: amount, credit: 0 },
});

describe('YearEndCloseService — net-P&L sign + retained-earnings transfer (YE1)', () => {
  it('1. Revenue 1000 / Expense 700 → RE increases by +300 (credit)', async () => {
    const { svc, identity, captured } = build([revenue('rev', 1000), expense('exp', 700)]);
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('300.00');
    expect(reSignedMovement(captured)).toBeCloseTo(300, 6);
    expect(reLine(captured)?.creditAmount).toBeTruthy();
    expect(reLine(captured)?.debitAmount).toBeFalsy();
    expectBalanced(captured);
  });

  it('2. Revenue 700 / Expense 1000 → RE decreases by −300 (debit)', async () => {
    const { svc, identity, captured } = build([revenue('rev', 700), expense('exp', 1000)]);
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('-300.00');
    expect(reSignedMovement(captured)).toBeCloseTo(-300, 6);
    expect(reLine(captured)?.debitAmount).toBeTruthy();
    expect(reLine(captured)?.creditAmount).toBeFalsy();
    expectBalanced(captured);
  });

  it('3. Revenue == Expense → RE 0, no RE line, still balanced', async () => {
    const { svc, identity, captured } = build([revenue('rev', 900), expense('exp', 900)]);
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('0.00');
    expect(reLine(captured)).toBeUndefined();
    expectBalanced(captured);
  });

  it('4. Revenue only → full profit transferred to RE (credit)', async () => {
    const { svc, identity, captured } = build([revenue('rev', 1250)]);
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('1250.00');
    expect(reSignedMovement(captured)).toBeCloseTo(1250, 6);
    expectBalanced(captured);
  });

  it('5. Expense only → full loss transferred to RE (debit)', async () => {
    const { svc, identity, captured } = build([expense('exp', 480)]);
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('-480.00');
    expect(reSignedMovement(captured)).toBeCloseTo(-480, 6);
    expectBalanced(captured);
  });

  it('6. Multiple revenue + multiple expense accounts → exact net transfer', async () => {
    const { svc, identity, captured } = build([
      revenue('rev1', 1000),
      revenue('rev2', 500),
      { id: 'cogs', accountClass: 'COST_OF_SALES', balance: { debit: 400, credit: 0 } },
      expense('exp1', 300),
      expense('exp2', 200),
    ]);
    // net = (1000 + 500) − (400 + 300 + 200) = 1500 − 900 = 600
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('600.00');
    expect(reSignedMovement(captured)).toBeCloseTo(600, 6);
    expectBalanced(captured);
  });

  it('7. Existing RE balance is untouched — close posts only the current-year delta on top of it', async () => {
    // The closing journal never re-states prior retained earnings; it posts ONLY the
    // current result, so post-close RE = opening RE + current result by construction.
    const { svc, identity, captured } = build([revenue('rev', 1000), expense('exp', 250)]);
    const res = await svc.closeYear(identity, 'fy1');

    expect(res.netIncome).toBe('750.00');
    // Exactly one RE line, equal to the current-year result — nothing about opening RE.
    const reLines = captured[0].command.lines.filter((l) => l.accountId === RE_ACCOUNT);
    expect(reLines).toHaveLength(1);
    expect(reSignedMovement(captured)).toBeCloseTo(750, 6);
    expectBalanced(captured);
  });

  it('8. Close called twice → second call rejected (idempotent)', async () => {
    const { svc, identity } = build([revenue('rev', 1000)], { existingClose: true });
    await expect(svc.closeYear(identity, 'fy1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('9. Post-close closing journal is balanced (∑debits === ∑credits)', async () => {
    const { svc, identity, captured } = build([
      revenue('rev1', 2200),
      revenue('rev2', 800),
      expense('exp1', 1900),
      expense('exp2', 600),
    ]);
    await svc.closeYear(identity, 'fy1');
    expectBalanced(captured);
  });

  it('10. New-year P&L opening balances are zero — every P&L account is fully zeroed', async () => {
    const accounts = [revenue('rev', 1000), expense('exp', 700)];
    const { svc, identity, captured } = build(accounts);
    await svc.closeYear(identity, 'fy1');

    // Each P&L account gets a closing line that exactly offsets its residual balance.
    for (const a of accounts) {
      const line = captured[0].command.lines.find((l) => l.accountId === a.id);
      expect(line).toBeDefined();
      const posted = line!.debitAmount ? Number(line!.debitAmount) : -Number(line!.creditAmount);
      const residual = a.balance.debit - a.balance.credit; // signed residual
      // posted must be the exact opposite of the residual → account nets to zero.
      expect(posted + residual).toBeCloseTo(0, 6);
    }
  });

  it('11. Balance-sheet accounts are carried forward unchanged — close only touches P&L + RE', async () => {
    // account.findMany only returns INCOME/COST_OF_SALES/EXPENSE accounts, so no
    // balance-sheet account can ever appear in the closing journal (other than RE, the
    // deliberate transfer target).
    const { svc, identity, captured, prisma } = build([revenue('rev', 1000), expense('exp', 700)]);
    await svc.closeYear(identity, 'fy1');

    const touched = new Set(captured[0].command.lines.map((l) => l.accountId));
    const plIds = new Set(['rev', 'exp']);
    for (const id of touched) {
      expect(id === RE_ACCOUNT || plIds.has(id)).toBe(true);
    }
    // The posting-side account query is class-scoped to P&L accounts only.
    const whereArg = prisma.account.findMany.mock.calls[0][0].where;
    expect(JSON.stringify(whereArg)).toContain('INCOME');
    expect(JSON.stringify(whereArg)).not.toContain('ASSET');
  });

  it('invariant: closing journal debits === credits before AND after the RE transfer', async () => {
    // Before the RE line is added the P&L-zeroing lines carry a net imbalance equal to
    // the result; the RE line closes it. We assert the final journal is balanced (the RE
    // line is the last line pushed), which is the observable "after" state.
    const { svc, identity, captured } = build([
      revenue('rev', 3000),
      expense('exp', 1750),
    ]);
    await svc.closeYear(identity, 'fy1');

    const lines = captured[0].command.lines;
    const debits = lines.reduce((s, l) => s + (l.debitAmount ? Number(l.debitAmount) : 0), 0);
    const credits = lines.reduce((s, l) => s + (l.creditAmount ? Number(l.creditAmount) : 0), 0);
    expect(debits).toBeCloseTo(credits, 6);
    // And the imbalance the RE line had to absorb equals the net result.
    const reMovement = reSignedMovement(captured);
    expect(reMovement).toBeCloseTo(1250, 6);
  });

  it('respects the accounting-date rule: closing journal uses the period end date, not new Date()', async () => {
    const { svc, identity, captured } = build([revenue('rev', 1000), expense('exp', 700)]);
    await svc.closeYear(identity, 'fy1');
    expect(captured[0].command.accountingDate).toEqual(PERIOD_END);
  });
});
