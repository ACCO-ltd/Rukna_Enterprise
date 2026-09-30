import { describe, expect, it } from 'vitest';

import {
  createProfileProblems,
  earliestRepointDate,
  profileCodeFromName,
  repointProblems,
  shiftIsoDate,
} from './posting-profile-setup';

describe('profileCodeFromName', () => {
  it('upper-snakes the name and caps it at 50', () => {
    expect(profileCodeFromName('Site materials & tools')).toBe('SITE_MATERIALS_TOOLS');
    expect(profileCodeFromName('  -- ')).toBe('');
    expect(profileCodeFromName('x'.repeat(60))).toHaveLength(50);
  });
});

describe('createProfileProblems', () => {
  it('checks name, code pattern, taken codes and account', () => {
    const taken = new Set(['COST_51100']);
    expect(createProfileProblems({ name: '', code: 'bad code', accountCode: '' }, taken)).toEqual([
      'name',
      'code',
      'account',
    ]);
    expect(
      createProfileProblems({ name: 'Cement', code: 'COST_51100', accountCode: '51100' }, taken),
    ).toEqual(['code-taken']);
    expect(
      createProfileProblems({ name: 'Steel', code: 'COST_51200', accountCode: '51200' }, taken),
    ).toEqual([]);
  });
});

describe('re-point dates', () => {
  const latest = { accountCode: '51100', effectiveFrom: '2026-01-01T00:00:00.000Z' };

  it('must start after the latest version and change the account', () => {
    expect(repointProblems({ accountCode: '51200', effectiveFrom: '2026-01-01' }, latest)).toEqual([
      'effective-from-early',
    ]);
    expect(repointProblems({ accountCode: '51100', effectiveFrom: '2026-02-01' }, latest)).toEqual([
      'same-account',
    ]);
    expect(repointProblems({ accountCode: '51200', effectiveFrom: '2026-01-02' }, latest)).toEqual(
      [],
    );
    expect(repointProblems({ accountCode: '', effectiveFrom: '' }, latest)).toEqual([
      'account',
      'effective-from',
    ]);
  });

  it('defaults to today, or the day after a future-dated latest version', () => {
    expect(earliestRepointDate('2026-01-01', '2026-09-30')).toBe('2026-09-30');
    expect(earliestRepointDate('2026-12-31', '2026-09-30')).toBe('2027-01-01');
    expect(earliestRepointDate(null, '2026-09-30')).toBe('2026-09-30');
  });

  it('shifts across month and year ends', () => {
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftIsoDate('2026-12-31', 1)).toBe('2027-01-01');
  });
});
