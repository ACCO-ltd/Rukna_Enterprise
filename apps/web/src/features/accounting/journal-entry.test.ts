import { describe, expect, it } from 'vitest';

import {
  availableActions,
  canSaveDraft,
  draftProblems,
  emptyDraft,
  emptyLine,
  entryTotals,
  formatDifference,
  isBlankLine,
  journalTotals,
  lineProblems,
  toJournalPayload,
} from './journal-entry';
import type { JournalDraft, JournalLineDraft } from './journal-entry';

function line(overrides: Partial<JournalLineDraft> = {}): JournalLineDraft {
  return { accountId: 'acc-1', debit: '', credit: '', memo: '', ...overrides };
}

/** A balanced two-line journal: 2,500 debit against 2,500 credit. */
function draft(overrides: Partial<JournalDraft> = {}): JournalDraft {
  return {
    accountingDate: '2026-01-15',
    documentDate: '',
    description: 'Accrual — January office rent',
    currencyCode: 'USD',
    lines: [
      line({ accountId: 'acc-expense', debit: '2500.00' }),
      line({ accountId: 'acc-accrual', credit: '2500.00' }),
    ],
    ...overrides,
  };
}

describe('journalTotals', () => {
  it('sums each column', () => {
    const totals = journalTotals([
      line({ debit: '1000.00' }),
      line({ debit: '500.50' }),
      line({ credit: '1500.50' }),
    ]);

    expect(totals.debitMinor).toBe(150050);
    expect(totals.creditMinor).toBe(150050);
    expect(totals.balanced).toBe(true);
  });

  it('reports the difference and its direction', () => {
    const totals = journalTotals([line({ debit: '1000.00' }), line({ credit: '999.00' })]);

    expect(totals.differenceMinor).toBe(100);
    expect(totals.balanced).toBe(false);
  });

  /**
   * The reason this is done in minor units. Three lines of 0.10 against one of 0.30 sums to
   * 0.30000000000000004 in binary floating point, and the journal would report itself out of
   * balance by a fraction of a cent that no one can see or correct.
   */
  it('does not drift where floats would', () => {
    const totals = journalTotals([
      line({ debit: '0.10' }),
      line({ debit: '0.20' }),
      line({ credit: '0.30' }),
    ]);

    expect(totals.balanced).toBe(true);
    expect(totals.differenceMinor).toBe(0);
  });

  it('does not call an empty form balanced', () => {
    // Two blank lines are equal at zero. That is not a journal.
    expect(journalTotals([emptyLine(), emptyLine()]).balanced).toBe(false);
  });

  it('ignores a half-typed amount rather than blanking the totals', () => {
    const totals = journalTotals([line({ debit: '1000.00' }), line({ credit: '12.' })]);

    expect(totals.debitMinor).toBe(100000);
    expect(totals.creditMinor).toBe(1200);
  });
});

describe('lineProblems', () => {
  it('says nothing about a blank line', () => {
    // The editor opens with two. Flagging them before anything is typed reads as broken.
    expect(lineProblems([emptyLine(), emptyLine()]).size).toBe(0);
  });

  it('rejects a line carrying both a debit and a credit', () => {
    // `DoubleEntryValidator` throws on this: "cannot have both a debit and a credit amount".
    expect(lineProblems([line({ debit: '100.00', credit: '100.00' })]).get(0)).toBe(
      'both-amounts',
    );
  });

  it('rejects a line with an account but no amount', () => {
    expect(lineProblems([line({ memo: 'rent' })]).get(0)).toBe('no-amount');
  });

  it('treats a zero amount as no amount', () => {
    // The server rejects a line whose debit and credit are both zero. "0.00" parses fine —
    // it is the amount that is wrong, not the text.
    expect(lineProblems([line({ debit: '0.00' })]).get(0)).toBe('no-amount');
  });

  /**
   * The bug this guards. An unparseable amount must not read as a valid zero: the balance
   * check would then pass on a typo, the journal would be saved, submitted, approved, and
   * rejected at posting — with the error landing on whoever pressed Post.
   */
  it('rejects an unparseable amount rather than reading it as zero', () => {
    expect(lineProblems([line({ debit: '1,000.00' })]).get(0)).toBe('invalid-amount');
    expect(lineProblems([line({ debit: 'one thousand' })]).get(0)).toBe('invalid-amount');
  });

  it('rejects a negative amount', () => {
    // Direction is expressed by the column, not the sign.
    expect(lineProblems([line({ debit: '-100.00' })]).get(0)).toBe('negative-amount');
  });

  it('rejects an amount with no account chosen', () => {
    expect(lineProblems([line({ accountId: '', debit: '100.00' })]).get(0)).toBe('no-account');
  });

  it('accepts a well-formed line', () => {
    expect(lineProblems([line({ debit: '100.00' })]).size).toBe(0);
  });

  it('indexes problems by line position', () => {
    const problems = lineProblems([
      line({ debit: '100.00' }),
      line({ debit: '1,0' }),
      line({ credit: '100.00' }),
    ]);

    expect([...problems.keys()]).toEqual([1]);
  });
});

describe('draftProblems', () => {
  it('accepts a balanced two-line journal', () => {
    expect(draftProblems(draft())).toEqual([]);
    expect(canSaveDraft(draft())).toBe(true);
  });

  it.each([
    ['description-required', { description: '   ' }],
    ['accounting-date-required', { accountingDate: '' }],
    ['currency-required', { currencyCode: '' }],
  ])('requires %s', (problem, overrides) => {
    expect(draftProblems(draft(overrides))).toContain(problem);
  });

  it('requires at least two lines', () => {
    // `@ArrayMinSize(2)` on the DTO, and `DoubleEntryValidator` throws below two as well.
    const single = draft({ lines: [line({ debit: '100.00' }), emptyLine()] });
    expect(draftProblems(single)).toContain('too-few-lines');
  });

  it('reports an unbalanced journal', () => {
    const unbalanced = draft({
      lines: [line({ accountId: 'a', debit: '2500.00' }), line({ accountId: 'b', credit: '2400.00' })],
    });

    expect(draftProblems(unbalanced)).toContain('out-of-balance');
  });

  /**
   * Order matters. A line missing its amount is also out of balance, and leading with the
   * balance sends the user to the totals row instead of to the line that is actually wrong.
   */
  it('reports the line fault before the balance it causes', () => {
    const problems = draftProblems(
      draft({ lines: [line({ accountId: 'a', debit: '1,000' }), line({ accountId: 'b', credit: '1000.00' })] }),
    );

    expect(problems.indexOf('line-problems')).toBeLessThan(problems.indexOf('out-of-balance'));
  });

  it('does not report a balance fault while there are too few lines', () => {
    // One line is never balanced, but "add another line" is the useful thing to say.
    const problems = draftProblems(draft({ lines: [line({ debit: '100.00' }), emptyLine()] }));

    expect(problems).toContain('too-few-lines');
    expect(problems).not.toContain('out-of-balance');
  });

  it('refuses an empty draft', () => {
    expect(canSaveDraft(emptyDraft('2026-01-15', 'USD'))).toBe(false);
  });
});

describe('toJournalPayload', () => {
  it('sends each line with only the side it carries', () => {
    const payload = toJournalPayload(draft());

    expect(payload.lines).toEqual([
      {
        accountId: 'acc-expense',
        debitAmount: 2500,
        transactionCurrencyCode: 'USD',
      },
      {
        accountId: 'acc-accrual',
        creditAmount: 2500,
        transactionCurrencyCode: 'USD',
      },
    ]);
  });

  it('converts cents exactly', () => {
    const payload = toJournalPayload(
      draft({
        lines: [
          line({ accountId: 'a', debit: '1234.56' }),
          line({ accountId: 'b', credit: '1234.56' }),
        ],
      }),
    );

    expect(payload.lines[0]!.debitAmount).toBe(1234.56);
  });

  it('drops the spare blank line the editor keeps', () => {
    const payload = toJournalPayload(draft({ lines: [...draft().lines, emptyLine()] }));
    expect(payload.lines).toHaveLength(2);
  });

  it('omits documentDate when it was left blank', () => {
    // The server defaults it to the accounting date; sending "" would be a 400.
    expect(toJournalPayload(draft())).not.toHaveProperty('documentDate');
    expect(toJournalPayload(draft({ documentDate: '2026-01-20' })).documentDate).toBe(
      '2026-01-20',
    );
  });

  it('omits an empty memo', () => {
    const payload = toJournalPayload(draft());
    expect(payload.lines[0]).not.toHaveProperty('memo');
  });

  it('normalises the currency code', () => {
    expect(toJournalPayload(draft({ currencyCode: ' usd ' })).currencyCode).toBe('USD');
  });

  it('trims the description', () => {
    expect(toJournalPayload(draft({ description: '  Rent  ' })).description).toBe('Rent');
  });
});

describe('formatDifference', () => {
  it('renders the shortfall as a decimal string, without its sign', () => {
    // The sign is carried by the sentence — "out of balance by" — not by the number.
    expect(formatDifference(100)).toBe('1.00');
    expect(formatDifference(-100)).toBe('1.00');
  });
});

describe('availableActions', () => {
  it.each([
    ['DRAFT', ['submit']],
    ['SUBMITTED', ['approve', 'reject']],
    ['APPROVED', ['post']],
    ['POSTED', ['reverse']],
    ['REVERSED', []],
  ] as const)('offers %s exactly what the server accepts', (status, expected) => {
    expect(availableActions(status)).toEqual(expected);
  });

  /**
   * §6.17 draws `REJECTED → DRAFT`, but no endpoint performs that transition and `submit`
   * accepts a REJECTED journal directly. Offering nothing here would strand it.
   */
  it('lets a rejected journal be resubmitted', () => {
    expect(availableActions('REJECTED')).toEqual(['submit']);
  });
});

describe('entryTotals', () => {
  it('totals a saved journal from its lines', () => {
    const totals = entryTotals({
      lines: [
        { accountId: 'a', debitAmount: '2500.00', creditAmount: '0.00', description: null },
        { accountId: 'b', debitAmount: '0.00', creditAmount: '2500.00', description: null },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });

    expect(totals.balanced).toBe(true);
    expect(totals.debitMinor).toBe(250000);
  });

  it('reports a draft that does not balance', () => {
    const totals = entryTotals({
      lines: [
        { accountId: 'a', debitAmount: '2500.00', creditAmount: '0.00', description: null },
        { accountId: 'b', debitAmount: '0.00', creditAmount: '2400.00', description: null },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
    });

    expect(totals.balanced).toBe(false);
    expect(formatDifference(totals.differenceMinor)).toBe('100.00');
  });
});

describe('isBlankLine', () => {
  it('is true only when nothing at all has been entered', () => {
    expect(isBlankLine(emptyLine())).toBe(true);
    expect(isBlankLine(line({ memo: 'note' }))).toBe(false);
    expect(isBlankLine({ accountId: '', debit: '', credit: '', memo: '' })).toBe(true);
  });
});
