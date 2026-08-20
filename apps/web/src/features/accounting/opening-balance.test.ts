import { describe, expect, it } from 'vitest';

import {
  migrationBlockers,
  parseTrialBalance,
  toOpeningBalanceBody,
  trialBalanceTotals,
  unknownAccountCodes,
  zeroLines,
} from './opening-balance';
import type { Account } from './types';

function account(code: string): Account {
  return {
    id: `a-${code}`,
    code,
    status: 'ACTIVE',
    versions: [
      {
        id: `a-${code}-v1`,
        versionNumber: 1,
        name: code,
        accountClass: 'ASSET',
        accountSubtype: 'CASH_AND_BANK',
        normalBalance: 'DEBIT',
        isPostingAllowed: true,
        isControlAccount: false,
        controlledSubledgerType: null,
        controlPostingPolicy: 'UNRESTRICTED',
        parentAccountId: null,
        effectiveFrom: '2026-01-01',
        effectiveTo: null,
      },
    ],
  } as unknown as Account;
}

describe('parseTrialBalance', () => {
  it('parses tab-separated rows, as pasted from a spreadsheet', () => {
    const { lines, issues } = parseTrialBalance('10100\t5000.00\t0\n20000\t0\t5000.00');

    expect(issues).toEqual([]);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ accountCode: '10100', debitMinor: 500000, creditMinor: 0 });
    expect(lines[1]).toMatchObject({ accountCode: '20000', debitMinor: 0, creditMinor: 500000 });
  });

  it('parses comma-separated rows, as pasted from a CSV export', () => {
    const { lines } = parseTrialBalance('10100,5000.00,0');

    expect(lines[0]).toMatchObject({ accountCode: '10100', debitMinor: 500000 });
  });

  it('parses space-separated rows, as retyped by hand', () => {
    const { lines } = parseTrialBalance('10100  5000.00  0');

    expect(lines[0]).toMatchObject({ accountCode: '10100', debitMinor: 500000 });
  });

  /**
   * A trial balance exported with thousands separators is the common case, not the exception —
   * so a tab- or space-separated row keeps them, because the comma is not the field separator
   * there.
   */
  it('tolerates thousands separators when the separator is a tab', () => {
    const { lines, issues } = parseTrialBalance('10100\t1,234,567.89\t0');

    expect(issues).toEqual([]);
    expect(lines[0]!.debitMinor).toBe(123456789);
  });

  it('tolerates thousands separators when the separator is spaces', () => {
    const { lines, issues } = parseTrialBalance('10100  1,234,567.89  0');

    expect(issues).toEqual([]);
    expect(lines[0]!.debitMinor).toBe(123456789);
  });

  /**
   * In a comma-separated row the two uses of a comma are genuinely indistinguishable. Taking
   * the first three fields would read `1` as the debit and post a hundredth of the balance, so
   * the row is reported instead of guessed at.
   */
  it('reports rather than mis-parses a comma-separated row using thousands separators', () => {
    const { lines, issues } = parseTrialBalance('10100,1,234,567.89,0');

    expect(lines).toEqual([]);
    expect(issues[0]).toMatchObject({ kind: 'malformed', lineNumber: 1 });
  });

  it('treats a missing credit column as zero', () => {
    const { lines, issues } = parseTrialBalance('10100\t5000.00');

    expect(issues).toEqual([]);
    expect(lines[0]).toMatchObject({ debitMinor: 500000, creditMinor: 0 });
  });

  it('skips blank lines rather than reporting a trailing newline as an error', () => {
    const { lines, issues } = parseTrialBalance('10100\t100\t0\n\n\n');

    expect(lines).toHaveLength(1);
    expect(issues).toEqual([]);
  });

  it('reports a row with no amount column at all', () => {
    const { issues } = parseTrialBalance('10100');

    expect(issues[0]).toMatchObject({ kind: 'malformed', lineNumber: 1 });
  });

  /** `parseMinorUnits` returns null on a bad value rather than 0 — a typo must not post as zero. */
  it('reports an unparseable amount rather than reading it as zero', () => {
    const { lines, issues } = parseTrialBalance('10100\tabc\t0');

    expect(lines).toEqual([]);
    expect(issues[0]).toMatchObject({ kind: 'unparseable-amount', lineNumber: 1 });
  });

  it('reports a negative amount', () => {
    const { issues } = parseTrialBalance('10100\t-500\t0');

    expect(issues[0]).toMatchObject({ kind: 'negative', accountCode: '10100' });
  });

  /**
   * A trial balance line sits on one side. Both populated means the source was misread, and
   * the server would silently take the debit — `debitBalance ?? creditBalance`.
   */
  it('reports a line with amounts on both sides', () => {
    const { issues } = parseTrialBalance('10100\t500\t300');

    expect(issues[0]).toMatchObject({ kind: 'both-sides', accountCode: '10100' });
  });

  it('numbers issues from 1, matching the row the user sees', () => {
    const { issues } = parseTrialBalance('10100\t100\t0\n20000\tbad\t0');

    expect(issues[0]).toMatchObject({ lineNumber: 2 });
  });
});

describe('trialBalanceTotals', () => {
  it('sums both sides and reports the difference in minor units', () => {
    const { lines } = parseTrialBalance('10100\t5000\t0\n20000\t0\t4999.50');
    const totals = trialBalanceTotals(lines);

    expect(totals.balanced).toBe(false);
    expect(totals.differenceMinor).toBe(50);
  });

  it('is balanced when both sides agree exactly', () => {
    const { lines } = parseTrialBalance('10100\t5000\t0\n20000\t0\t5000');

    expect(trialBalanceTotals(lines).balanced).toBe(true);
  });
});

describe('unknownAccountCodes', () => {
  /**
   * The server 404s on the first unknown code and rolls back, so a fifty-line paste with four
   * bad codes would take four attempts. All of them are listed at once.
   */
  it('lists every code missing from the chart, deduplicated and sorted', () => {
    const { lines } = parseTrialBalance(
      '10100\t100\t0\n99999\t100\t0\n88888\t0\t200\n99999\t50\t0',
    );

    expect(unknownAccountCodes(lines, [account('10100')])).toEqual(['88888', '99999']);
  });

  it('is empty when every code resolves', () => {
    const { lines } = parseTrialBalance('10100\t100\t0');

    expect(unknownAccountCodes(lines, [account('10100')])).toEqual([]);
  });
});

describe('zeroLines', () => {
  /** `if (amount.lte(0)) continue` — the row was typed, posts nothing, and nothing says so. */
  it('finds rows the server will silently skip', () => {
    const { lines } = parseTrialBalance('10100\t0\t0\n20000\t100\t0');

    expect(zeroLines(lines).map((l) => l.accountCode)).toEqual(['10100']);
  });
});

describe('migrationBlockers', () => {
  const header = {
    cutoverDate: '2026-01-01',
    batchReference: 'OB-2026-01',
    arAccountCode: '11000',
    apAccountCode: '20000',
  };

  function blockersFor(paste: string, accounts: Account[] = [account('10100'), account('20000')]) {
    const { lines, issues } = parseTrialBalance(paste);
    return migrationBlockers({
      lines,
      issues,
      unknownCodes: unknownAccountCodes(lines, accounts),
      totals: trialBalanceTotals(lines),
      ...header,
    });
  }

  it('is empty for a balanced paste with known codes and a complete header', () => {
    expect(blockersFor('10100\t5000\t0\n20000\t0\t5000')).toEqual([]);
  });

  it('blocks an empty paste', () => {
    expect(blockersFor('')).toContain('no-lines');
  });

  it('blocks on parse issues', () => {
    expect(blockersFor('10100\tabc\t0')).toContain('parse-issues');
  });

  it('blocks on an unknown code', () => {
    expect(blockersFor('99999\t100\t0\n20000\t0\t100')).toContain('unknown-codes');
  });

  it('blocks an out-of-balance trial balance, as the server would', () => {
    expect(blockersFor('10100\t5000\t0\n20000\t0\t4000')).toContain('out-of-balance');
  });

  /**
   * A paste of nothing but zero rows balances — both sides are zero — and would import an
   * empty journal that can never be re-run without a reversal.
   */
  it('blocks a paste that balances only because everything is zero', () => {
    const blockers = blockersFor('10100\t0\t0\n20000\t0\t0');

    expect(blockers).toContain('all-zero');
    expect(blockers).not.toContain('out-of-balance');
  });

  it('blocks a missing header field', () => {
    const { lines, issues } = parseTrialBalance('10100\t100\t0\n20000\t0\t100');
    const blockers = migrationBlockers({
      lines,
      issues,
      unknownCodes: [],
      totals: trialBalanceTotals(lines),
      ...header,
      batchReference: '   ',
    });

    expect(blockers).toContain('missing-header');
  });
});

describe('toOpeningBalanceBody', () => {
  it('sends only the populated side of each line', () => {
    const { lines } = parseTrialBalance('10100\t5000.00\t0\n20000\t0\t5000.00');

    const body = toOpeningBalanceBody({
      lines,
      cutoverDate: '2026-01-01',
      batchReference: ' OB-2026-01 ',
      arAccountCode: '11000',
      apAccountCode: '20000',
    });

    expect(body.batchReference).toBe('OB-2026-01');
    expect(body.trialBalance).toEqual([
      { accountCode: '10100', debitBalance: 5000 },
      { accountCode: '20000', creditBalance: 5000 },
    ]);
  });

  it('sends amounts as JSON numbers, which is what the DTO takes', () => {
    const { lines } = parseTrialBalance('10100\t1234.56\t0');
    const body = toOpeningBalanceBody({
      lines,
      cutoverDate: '2026-01-01',
      batchReference: 'X',
      arAccountCode: '11000',
      apAccountCode: '20000',
    });

    expect(body.trialBalance[0]!.debitBalance).toBe(1234.56);
    expect(typeof body.trialBalance[0]!.debitBalance).toBe('number');
  });
});
