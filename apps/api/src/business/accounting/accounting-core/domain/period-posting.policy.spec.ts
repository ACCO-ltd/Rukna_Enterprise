import { BadRequestException } from '@nestjs/common';

import { PeriodValidator } from '../application/validators/period.validator.js';
import { periodPostingBlock, periodPostingBlockMessage } from './period-posting.policy.js';

describe('periodPostingBlock (ADR-043 — one rule for the ledger and the eligibility read models)', () => {
  it('no period → NO_PERIOD', () => {
    expect(periodPostingBlock(null, 'ACCOUNTS_PAYABLE')).toBe('NO_PERIOD');
  });
  it('OPEN → null', () => {
    expect(periodPostingBlock({ name: 'Oct', status: 'OPEN' }, 'ACCOUNTS_PAYABLE')).toBeNull();
  });
  it('CLOSED refuses every category', () => {
    expect(periodPostingBlock({ name: 'Oct', status: 'CLOSED' }, 'YEAR_END_CLOSE')).toBe('PERIOD_CLOSED');
  });
  it('LOCKED refuses ordinary business but accepts closing entries', () => {
    expect(periodPostingBlock({ name: 'Dec', status: 'LOCKED' }, 'ACCOUNTS_RECEIVABLE')).toBe('PERIOD_LOCKED');
    expect(periodPostingBlock({ name: 'Dec', status: 'LOCKED' }, 'CLOSING_ADJUSTMENT')).toBeNull();
    expect(periodPostingBlock({ name: 'Dec', status: 'LOCKED' }, 'YEAR_END_CLOSE')).toBeNull();
  });
  it('keeps the ledger messages unchanged', () => {
    const accountingDate = new Date('2026-10-03T00:00:00Z');
    expect(periodPostingBlockMessage('NO_PERIOD', { accountingDate, journalCategory: 'X' })).toBe(
      'No accounting period covers 2026-10-03 for this organization',
    );
    expect(periodPostingBlockMessage('PERIOD_CLOSED', { accountingDate, periodName: 'Oct', journalCategory: 'X' })).toBe(
      'Accounting period "Oct" is CLOSED — no further postings allowed',
    );
    expect(periodPostingBlockMessage('PERIOD_LOCKED', { accountingDate, periodName: 'Dec', journalCategory: 'X' })).toMatch(
      /^Period "Dec" is LOCKED — only CLOSING_ADJUSTMENT and YEAR_END_CLOSE journals are accepted\. Received category: X$/,
    );
  });
});

describe('PeriodValidator.resolve agrees with periodPostingBlock', () => {
  const tx = (period: { id: string; name: string; status: string } | null, lockedStatus?: string) =>
    ({
      accountingPeriod: { findFirst: jest.fn().mockResolvedValue(period) },
      $queryRaw: jest.fn().mockResolvedValue(period ? [{ status: lockedStatus ?? period.status }] : []),
    }) as never;
  const date = new Date('2026-10-03T00:00:00Z');

  it.each([
    [null, 'ACCOUNTS_PAYABLE'],
    [{ id: 'p', name: 'Oct', status: 'CLOSED' }, 'ACCOUNTS_PAYABLE'],
    [{ id: 'p', name: 'Dec', status: 'LOCKED' }, 'ACCOUNTS_PAYABLE'],
  ])('a blocked period (%o) makes resolve throw the same message', async (period, category) => {
    const block = periodPostingBlock(period, category)!;
    expect(block).not.toBeNull();
    const promise = PeriodValidator.resolve(tx(period), 'org', date, category);
    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(PeriodValidator.resolve(tx(period), 'org', date, category)).rejects.toThrow(
      periodPostingBlockMessage(block, { accountingDate: date, periodName: period?.name, journalCategory: category }),
    );
  });

  it('an open period resolves', async () => {
    await expect(
      PeriodValidator.resolve(tx({ id: 'p', name: 'Oct', status: 'OPEN' }), 'org', date, 'ACCOUNTS_PAYABLE'),
    ).resolves.toMatchObject({ id: 'p', status: 'OPEN' });
  });

  it('reads the status under the lock (a close that won the race refuses the posting)', async () => {
    await expect(
      PeriodValidator.resolve(tx({ id: 'p', name: 'Oct', status: 'OPEN' }, 'CLOSED'), 'org', date, 'ACCOUNTS_PAYABLE'),
    ).rejects.toThrow(/CLOSED/);
  });
});
