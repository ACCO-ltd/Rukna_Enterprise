import { describe, expect, it } from 'vitest';

import {
  ACCOUNT_SUBTYPES,
  ACCOUNT_SUBTYPE_GROUPS,
  CONTROL_POSTING_POLICIES,
  accountDraftProblems,
  conventionalBalance,
  emptyAccountDraft,
  isContraBalance,
  toCreateAccountBody,
  type AccountDraft,
} from './coa-setup';

function draft(overrides: Partial<AccountDraft> = {}): AccountDraft {
  return {
    ...emptyAccountDraft(),
    code: '10100',
    name: 'Salaam Bank',
    accountClass: 'ASSET',
    accountSubtype: 'CASH_AND_BANK',
    normalBalance: 'DEBIT',
    effectiveFrom: '2026-01-01',
    ...overrides,
  };
}

describe('conventionalBalance', () => {
  it('puts assets, cost of sales and expenses on the debit side', () => {
    expect(conventionalBalance('ASSET')).toBe('DEBIT');
    expect(conventionalBalance('COST_OF_SALES')).toBe('DEBIT');
    expect(conventionalBalance('EXPENSE')).toBe('DEBIT');
  });

  it('puts liabilities, equity and income on the credit side', () => {
    expect(conventionalBalance('LIABILITY')).toBe('CREDIT');
    expect(conventionalBalance('EQUITY')).toBe('CREDIT');
    expect(conventionalBalance('INCOME')).toBe('CREDIT');
  });
});

describe('isContraBalance', () => {
  it('is false for a conventional pairing', () => {
    expect(isContraBalance('ASSET', 'DEBIT')).toBe(false);
    expect(isContraBalance('INCOME', 'CREDIT')).toBe(false);
  });

  /**
   * Accumulated depreciation is an ASSET-class account with a CREDIT balance and it is
   * correct. This is why the form warns instead of blocking — a blocked contra account is an
   * accountant unable to model depreciation.
   */
  it('is true for a contra account, which is legitimate and must not be blocked', () => {
    expect(isContraBalance('ASSET', 'CREDIT')).toBe(true);
    expect(isContraBalance('INCOME', 'DEBIT')).toBe(true);
  });
});

describe('subtype list', () => {
  /**
   * Thirty, verified by diffing this list against the `AccountSubtype` enum in
   * `schema.prisma` — no value missing and none invented. The count is pinned because a
   * subtype absent from the picker is an account nobody can create, and nothing else here
   * would notice.
   */
  it('covers all 30 schema subtypes with no duplicates', () => {
    expect(ACCOUNT_SUBTYPES).toHaveLength(30);
    expect(new Set(ACCOUNT_SUBTYPES).size).toBe(30);
  });

  /**
   * The seeded chart creates UNAPPLIED_CLIENT_RECEIPTS as a LIABILITY, while the schema's own
   * section comment files it under `// Assets`. The groups here are display order only, and
   * this pins the one that proves they are not a class mapping.
   */
  it('groups unapplied client receipts with liabilities, as the seed creates it', () => {
    const liabilities = ACCOUNT_SUBTYPE_GROUPS.find((g) => g.group === 'liabilities');

    expect(liabilities?.subtypes).toContain('UNAPPLIED_CLIENT_RECEIPTS');
  });

  it('offers every subtype regardless of class, since the server checks no pairing', () => {
    // A single flat list means no class can hide a subtype from the picker.
    expect(ACCOUNT_SUBTYPES).toContain('ACCUMULATED_DEPRECIATION');
    expect(ACCOUNT_SUBTYPES).toContain('VAT_INPUT_RECOVERABLE');
  });
});

describe('control posting policies', () => {
  /**
   * A6. The schema has three; the DTO's `@IsEnum` accepts two. The seeded bank and VAT
   * accounts use the third, so they cannot be reproduced through the API. Pinned so that a
   * future reader adding the third value checks the DTO first.
   */
  it('offers only the two the DTO accepts', () => {
    expect(CONTROL_POSTING_POLICIES).toEqual(['UNRESTRICTED', 'SYSTEM_ONLY']);
    expect(CONTROL_POSTING_POLICIES).not.toContain('SYSTEM_OR_APPROVED_ADJUSTMENT');
  });
});

describe('accountDraftProblems', () => {
  it('accepts a complete draft', () => {
    expect(accountDraftProblems(draft())).toEqual([]);
  });

  /**
   * All six reported together. §6.13 omits `controlPostingPolicy` and `effectiveFrom` (A5), so
   * someone working from the reference is missing two — meeting them one 400 at a time is the
   * worst version of this.
   */
  it('reports every missing required field at once, not just the first', () => {
    const problems = accountDraftProblems(emptyAccountDraft());

    expect(problems).toEqual([
      'code',
      'name',
      'accountClass',
      'accountSubtype',
      'normalBalance',
      'effectiveFrom',
    ]);
  });

  it('treats whitespace as missing', () => {
    expect(accountDraftProblems(draft({ code: '   ', name: '  ' }))).toEqual(['code', 'name']);
  });

  it('requires a subledger type on a control account', () => {
    expect(accountDraftProblems(draft({ isControlAccount: true }))).toEqual(['subledgerType']);
    expect(
      accountDraftProblems(
        draft({ isControlAccount: true, controlledSubledgerType: 'ACCOUNTS_PAYABLE' }),
      ),
    ).toEqual([]);
  });
});

describe('toCreateAccountBody', () => {
  it('returns null for an incomplete draft rather than a partial body', () => {
    expect(toCreateAccountBody(emptyAccountDraft())).toBeNull();
  });

  it('sends every field the DTO requires', () => {
    expect(toCreateAccountBody(draft())).toEqual({
      code: '10100',
      name: 'Salaam Bank',
      accountClass: 'ASSET',
      accountSubtype: 'CASH_AND_BANK',
      normalBalance: 'DEBIT',
      isPostingAllowed: true,
      isControlAccount: false,
      controlPostingPolicy: 'UNRESTRICTED',
      effectiveFrom: '2026-01-01',
    });
  });

  /**
   * `forbidNonWhitelisted: true` plus `@IsString()` on an optional field means `''` is a 400,
   * not "absent". Every optional field has to be omitted rather than emptied.
   */
  it('omits empty optional fields instead of sending empty strings', () => {
    const body = toCreateAccountBody(draft({ parentAccountCode: '' }))!;

    expect(body).not.toHaveProperty('nameAr');
    expect(body).not.toHaveProperty('parentAccountCode');
    expect(body).not.toHaveProperty('controlledSubledgerType');
  });

  it('includes optional fields when they carry a value, trimmed', () => {
    const body = toCreateAccountBody(
      draft({ parentAccountCode: ' 10000 ' }),
    )!;

    expect(body.parentAccountCode).toBe('10000');
  });

  /** A subledger type on a non-control account would be meaningless; it is dropped. */
  it('omits the subledger type when the account is not a control account', () => {
    const body = toCreateAccountBody(
      draft({ isControlAccount: false, controlledSubledgerType: 'BANK' }),
    )!;

    expect(body).not.toHaveProperty('controlledSubledgerType');
  });

  it('sends the subledger type on a control account', () => {
    const body = toCreateAccountBody(
      draft({ isControlAccount: true, controlledSubledgerType: 'ACCOUNTS_RECEIVABLE' }),
    )!;

    expect(body.controlledSubledgerType).toBe('ACCOUNTS_RECEIVABLE');
    expect(body.isControlAccount).toBe(true);
  });
});
