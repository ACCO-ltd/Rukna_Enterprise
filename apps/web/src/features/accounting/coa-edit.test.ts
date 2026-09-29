import { describe, expect, it } from 'vitest';

import {
  editAccountDraftFrom,
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
