import { describe, expect, it } from 'vitest';

import {
  accountLabel,
  accountMatches,
  accountName,
  currentVersion,
  indexAccounts,
  lineAccountLabel,
  postableAccounts,
  versionEffectiveOn,
} from './account-display';
import type { Account, AccountVersion } from './types';

function version(overrides: Partial<AccountVersion> = {}): AccountVersion {
  return {
    id: 'ver-1',
    accountId: 'acc-1',
    versionNumber: 1,
    name: 'Salaam Bank',
    parentAccountId: null,
    accountClass: 'ASSET',
    accountSubtype: 'CASH_AND_BANK',
    isPostingAllowed: true,
    isControlAccount: false,
    controlledSubledgerType: null,
    controlPostingPolicy: 'UNRESTRICTED',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    ...overrides,
  };
}

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 'acc-1',
    organizationId: 'org-1',
    code: '10100',
    normalBalance: 'DEBIT',
    status: 'ACTIVE',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'user-1',
    versions: [version()],
    ...overrides,
  };
}

describe('currentVersion', () => {
  it('takes the highest version number, not the array order', () => {
    const acc = account({
      versions: [version({ versionNumber: 1, name: 'Old' }), version({ versionNumber: 3, name: 'New' })],
    });

    expect(currentVersion(acc)?.name).toBe('New');
  });

  it('is null for an account with no version', () => {
    expect(currentVersion(account({ versions: [] }))).toBeNull();
  });
});

describe('versionEffectiveOn', () => {
  const renamed = account({
    versions: [
      version({ versionNumber: 1, name: 'Bank — old name', effectiveFrom: '2025-01-01', effectiveTo: '2026-06-01' }),
      version({ versionNumber: 2, name: 'Bank — new name', effectiveFrom: '2026-06-01', effectiveTo: null }),
    ],
  });

  it('resolves the version in force on the date', () => {
    expect(versionEffectiveOn(renamed, '2025-09-15')?.name).toBe('Bank — old name');
    expect(versionEffectiveOn(renamed, '2026-08-01')?.name).toBe('Bank — new name');
  });

  /**
   * `effectiveTo` is EXCLUSIVE — `[effectiveFrom, effectiveTo)` per the schema comment. On the
   * changeover date itself the NEW version applies. An inclusive reading would put two
   * versions in force for one day and pick whichever sorted first.
   */
  it('treats effectiveTo as exclusive', () => {
    expect(versionEffectiveOn(renamed, '2026-06-01')?.name).toBe('Bank — new name');
    expect(versionEffectiveOn(renamed, '2026-05-31')?.name).toBe('Bank — old name');
  });

  it('accepts a full timestamp, not just a date', () => {
    expect(versionEffectiveOn(renamed, '2026-06-01T14:30:00.000Z')?.name).toBe('Bank — new name');
  });

  it('is null before any version took effect', () => {
    // A real state: an account created this year has no version covering last year's entries.
    expect(versionEffectiveOn(renamed, '2024-01-01')).toBeNull();
  });

  it('prefers the later version if two ranges ever overlap', () => {
    const overlapping = account({
      versions: [
        version({ versionNumber: 1, name: 'First', effectiveFrom: '2026-01-01', effectiveTo: null }),
        version({ versionNumber: 2, name: 'Second', effectiveFrom: '2026-01-01', effectiveTo: null }),
      ],
    });

    expect(versionEffectiveOn(overlapping, '2026-03-01')?.name).toBe('Second');
  });
});

describe('accountName', () => {


  it('falls back to the code when there is no version at all', () => {
    expect(accountName(account({ versions: [] }), 'en')).toBe('10100');
  });
});

describe('accountLabel', () => {
  it('leads with the code, which is how accountants refer to an account', () => {
    expect(accountLabel(account(), 'en')).toBe('10100 — Salaam Bank');
  });

  it('does not repeat the code when that is all there is', () => {
    expect(accountLabel(account({ versions: [] }), 'en')).toBe('10100');
  });
});

describe('lineAccountLabel', () => {
  const accounts = indexAccounts([account()]);

  it('uses the posted snapshot, which stays correct after a rename', () => {
    const label = lineAccountLabel(
      { accountId: 'acc-1', accountCodeSnapshot: '10100', accountNameSnapshot: 'Salaam Bank (2026)' },
      accounts,
      'en',
    );

    expect(label).toBe('10100 — Salaam Bank (2026)');
  });

  /**
   * A DRAFT journal's lines carry empty snapshots — `manual-journal.service.ts` writes `''`
   * and the posting engine fills them later. Without the live lookup a draft's lines would
   * render blank, which is the screen where someone is deciding whether to approve it.
   */
  it('resolves a draft line live, since its snapshots are empty', () => {
    const label = lineAccountLabel(
      { accountId: 'acc-1', accountCodeSnapshot: '', accountNameSnapshot: '' },
      accounts,
      'en',
    );

    expect(label).toBe('10100 — Salaam Bank');
  });

  it('falls back to the id tail when neither a snapshot nor an account exists', () => {
    const label = lineAccountLabel(
      { accountId: 'acc-deleted-abcd1234', accountCodeSnapshot: '', accountNameSnapshot: '' },
      accounts,
      'en',
    );

    expect(label).toBe('abcd1234');
  });

  it('uses the code alone when the snapshot has no name', () => {
    const label = lineAccountLabel(
      { accountId: 'acc-1', accountCodeSnapshot: '10100', accountNameSnapshot: '' },
      accounts,
      'en',
    );

    expect(label).toBe('10100');
  });
});

describe('postableAccounts', () => {
  it('excludes a SYSTEM_ONLY control account', () => {
    // AR and AP control accounts. Offering one invites an entry the server rejects at
    // posting — after approval, when it is most expensive to find out.
    const ap = account({
      id: 'acc-ap',
      code: '20000',
      versions: [version({ isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY' })],
    });

    expect(postableAccounts([account(), ap]).map((a) => a.id)).toEqual(['acc-1']);
  });

  it('includes a SYSTEM_OR_APPROVED_ADJUSTMENT account', () => {
    // The banks carry this policy, and a CFO-approved journal is the approved adjustment.
    const bank = account({
      id: 'acc-bank',
      versions: [version({ controlPostingPolicy: 'SYSTEM_OR_APPROVED_ADJUSTMENT' })],
    });

    expect(postableAccounts([bank]).map((a) => a.id)).toEqual(['acc-bank']);
  });

  it('excludes an account that does not allow posting', () => {
    const header = account({ id: 'acc-header', versions: [version({ isPostingAllowed: false })] });
    expect(postableAccounts([header])).toEqual([]);
  });

  it('excludes an inactive account', () => {
    expect(postableAccounts([account({ status: 'INACTIVE' })])).toEqual([]);
  });

  it('excludes an account with no version to judge by', () => {
    expect(postableAccounts([account({ versions: [] })])).toEqual([]);
  });
});

describe('accountMatches', () => {
  it('matches on code', () => {
    expect(accountMatches(account(), '101')).toBe(true);
  });

  it('matches on the account name', () => {
    expect(accountMatches(account(), 'salaam')).toBe(true);
  });

  it('matches on subtype, so "cash" finds the bank accounts', () => {
    expect(accountMatches(account(), 'cash')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(accountMatches(account(), 'SALAAM')).toBe(true);
  });

  it('matches everything on an empty query', () => {
    expect(accountMatches(account(), '   ')).toBe(true);
  });

  it('does not match an unrelated term', () => {
    expect(accountMatches(account(), 'retained')).toBe(false);
  });
});
