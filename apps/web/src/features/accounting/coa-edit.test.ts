import { describe, expect, it } from 'vitest';

import {
  editAccountDraftFrom,
  suggestChildCode,
  editAccountProblem,
  toUpdateAccountBody,
  type EditAccountDraft,
} from './coa-setup';
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

const PARENT = account({ id: 'acc-parent', code: '10000', versions: [version({ accountId: 'acc-parent', name: 'Assets' })] });

describe('editAccountDraftFrom', () => {
  it('prefills the editable fields from the current version', () => {
    const draft = editAccountDraftFrom(account(), []);
    expect(draft).toEqual({
      name: 'Salaam Bank',
      isPostingAllowed: true,
      parentAccountCode: '',
      changeReason: '',
    });
  });

  it('resolves the parent id to its code against the chart', () => {
    const child = account({ versions: [version({ parentAccountId: 'acc-parent' })] });
    const draft = editAccountDraftFrom(child, [child, PARENT]);
    expect(draft.parentAccountCode).toBe('10000');
  });

  it('falls back to detached when the parent cannot be resolved', () => {
    const child = account({ versions: [version({ parentAccountId: 'gone' })] });
    const draft = editAccountDraftFrom(child, [child]);
    expect(draft.parentAccountCode).toBe('');
  });
});

describe('toUpdateAccountBody', () => {
  const original: EditAccountDraft = {
    name: 'Salaam Bank',
    isPostingAllowed: true,
    parentAccountCode: '10000',
    changeReason: '',
  };

  it('returns null when nothing changed', () => {
    expect(toUpdateAccountBody({ ...original }, original)).toBeNull();
  });

  it('sends only the fields that changed', () => {
    const body = toUpdateAccountBody({ ...original, name: 'Salaam Bank — Main' }, original);
    expect(body).toEqual({ name: 'Salaam Bank — Main' });
  });

  it('sends an empty string to detach the parent', () => {
    const body = toUpdateAccountBody({ ...original, parentAccountCode: '' }, original);
    expect(body).toEqual({ parentAccountCode: '' });
  });

  it('sends a re-parent to a new code', () => {
    const body = toUpdateAccountBody({ ...original, parentAccountCode: '20000' }, original);
    expect(body).toEqual({ parentAccountCode: '20000' });
  });

  it('sends the posting flag when toggled', () => {
    const body = toUpdateAccountBody({ ...original, isPostingAllowed: false }, original);
    expect(body).toEqual({ isPostingAllowed: false });
  });

  it('carries a change reason alongside a real change', () => {
    const body = toUpdateAccountBody(
      { ...original, name: 'Renamed', changeReason: 'Statutory chart' },
      original,
    );
    expect(body).toEqual({ name: 'Renamed', changeReason: 'Statutory chart' });
  });

  it('does not fire a request for a change reason with no substantive change', () => {
    const body = toUpdateAccountBody({ ...original, changeReason: 'no-op' }, original);
    expect(body).toBeNull();
  });

  it('ignores a whitespace-only rename', () => {
    const body = toUpdateAccountBody({ ...original, name: '   Salaam Bank   ' }, original);
    expect(body).toBeNull();
  });
});

describe('editAccountProblem', () => {
  it('flags an empty name', () => {
    expect(editAccountProblem({ name: '  ', isPostingAllowed: true, parentAccountCode: '', changeReason: '' })).toBe('name');
  });

  it('passes a non-empty name', () => {
    expect(editAccountProblem({ name: 'Cash', isPostingAllowed: true, parentAccountCode: '', changeReason: '' })).toBeNull();
  });
});

describe('suggestChildCode', () => {
  function child(code: string, parentId: string): Account {
    return account({ id: `acc-${code}`, code, versions: [version({ accountId: `acc-${code}`, parentAccountId: parentId })] });
  }
  const MATERIALS = account({ id: 'acc-51000', code: '51000', versions: [version({ accountId: 'acc-51000' })] });

  it('steps a tenth of the parent block: the first child of 51000 is 51100', () => {
    expect(suggestChildCode(MATERIALS, [MATERIALS])).toBe('51100');
  });

  it('continues after the last child rather than filling from the top', () => {
    const chart = [MATERIALS, child('51100', 'acc-51000'), child('51300', 'acc-51000')];
    expect(suggestChildCode(MATERIALS, chart)).toBe('51400');
  });

  it('falls back to the first gap when the end of the block is taken', () => {
    const codes = ['51100', '51200', '51300', '51400', '51500', '51600', '51700', '51900'];
    const chart = [MATERIALS, ...codes.map((c) => child(c, 'acc-51000'))];
    expect(suggestChildCode(MATERIALS, chart)).toBe('51800');
  });

  it('skips a code taken by an account elsewhere in the chart', () => {
    const chart = [MATERIALS, account({ id: 'x', code: '51100' })];
    expect(suggestChildCode(MATERIALS, chart)).toBe('51200');
  });

  it('never leaves the block: a full block suggests nothing', () => {
    const codes = ['51100', '51200', '51300', '51400', '51500', '51600', '51700', '51800', '51900'];
    const chart = [MATERIALS, ...codes.map((c) => child(c, 'acc-51000'))];
    expect(suggestChildCode(MATERIALS, chart)).toBeNull();
  });

  it('offers nothing for a code too long to survive a round trip through a number', () => {
    const long = account({ id: 'long', code: '1000000000000000000000' });
    expect(suggestChildCode(long, [long])).toBeNull();
  });

  it('steps by one under a parent ending in a single zero, and offers nothing for a code with none', () => {
    const odd = account({ id: 'odd', code: '51150' });
    expect(suggestChildCode(odd, [odd])).toBe('51151');
    const text = account({ id: 'text', code: 'CASH' });
    expect(suggestChildCode(text, [text])).toBeNull();
    const noZero = account({ id: 'nz', code: '51151' });
    expect(suggestChildCode(noZero, [noZero])).toBeNull();
  });
});
