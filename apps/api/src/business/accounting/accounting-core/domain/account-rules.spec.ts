import { accountFieldsProblem, deactivateProblem, isHeading, parentProblem, postingSwitchProblem } from './account-rules';

const heading = { id: 'h', code: '60000', name: 'Administrative expenses', accountClass: 'EXPENSE' as const, heading: true, active: true, lineage: ['h'] };

describe('account rules (GL-C)', () => {
  it('reads a heading as not postable and not kept by the system', () => {
    expect(isHeading({ isPostingAllowed: false, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' })).toBe(true);
    expect(isHeading({ isPostingAllowed: false, isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY' })).toBe(false);
    expect(isHeading({ isPostingAllowed: false, isControlAccount: false, controlPostingPolicy: 'SYSTEM_ONLY' })).toBe(false);
  });

  it('wants a readable code, a name, a subtype of the class and a real date', () => {
    expect(accountFieldsProblem({ code: ' 61100 ' })).toBeNull();
    expect(accountFieldsProblem({ code: '61 100' })?.errorCode).toBe('ACCOUNT_CODE_INVALID');
    expect(accountFieldsProblem({ name: '  ' })?.errorCode).toBe('FIELD_REQUIRED');
    expect(accountFieldsProblem({ accountClass: 'INCOME', accountSubtype: 'CASH_AND_BANK' })?.errorCode).toBe('SUBTYPE_NOT_IN_CLASS');
    expect(accountFieldsProblem({ accountClass: 'LIABILITY', accountSubtype: 'UNAPPLIED_CLIENT_RECEIPTS' })).toBeNull();
    expect(accountFieldsProblem({ effectiveFrom: '2026-02-31' })?.errorCode).toBe('DATE_INVALID');
  });

  it('puts an account only under an active heading of its class, never under itself', () => {
    expect(parentProblem({ accountClass: 'EXPENSE' }, heading, '60000')).toBeNull();
    expect(parentProblem({ accountClass: 'EXPENSE' }, null, '99')?.errorCode).toBe('PARENT_NOT_FOUND');
    expect(parentProblem({ accountClass: 'ASSET' }, heading, '60000')?.errorCode).toBe('PARENT_OTHER_CLASS');
    expect(parentProblem({ accountClass: 'EXPENSE' }, { ...heading, heading: false }, '60000')?.errorCode).toBe('PARENT_NOT_HEADING');
    expect(parentProblem({ accountClass: 'EXPENSE' }, { ...heading, active: false }, '60000')?.errorCode).toBe('PARENT_INACTIVE');
    expect(parentProblem({ id: 'top', accountClass: 'EXPENSE' }, { ...heading, lineage: ['h', 'top'] }, '60000')?.errorCode).toBe('PARENT_CYCLE');
  });

  it('keeps entries visible and headings heading', () => {
    const none = { hasEntries: false, hasChildren: false, linkedToBank: false };
    expect(postingSwitchProblem(false, { ...none, hasEntries: true })?.errorCode).toBe('ACCOUNT_HAS_ENTRIES');
    expect(postingSwitchProblem(false, { ...none, linkedToBank: true })?.errorCode).toBe('ACCOUNT_LINKED_TO_BANK');
    expect(postingSwitchProblem(true, { ...none, hasChildren: true })?.errorCode).toBe('ACCOUNT_HAS_CHILDREN');
    expect(postingSwitchProblem(false, none)).toBeNull();
  });

  it('makes an account inactive only when it holds nothing and nothing posts to it', () => {
    const clear = { balance: '0.00', activeChildren: 0, linkedToBank: false, usedBy: [] };
    expect(deactivateProblem(clear)).toBeNull();
    expect(deactivateProblem({ ...clear, balance: '-600.00' })?.errorCode).toBe('ACCOUNT_HAS_BALANCE');
    expect(deactivateProblem({ ...clear, activeChildren: 2 })?.errorCode).toBe('ACCOUNT_HAS_ACTIVE_CHILDREN');
    expect(deactivateProblem({ ...clear, linkedToBank: true })?.errorCode).toBe('ACCOUNT_LINKED_TO_BANK');
    expect(deactivateProblem({ ...clear, usedBy: ['tax code VAT5'] })).toMatchObject({ errorCode: 'ACCOUNT_IN_USE', message: 'Still used by tax code VAT5.' });
  });
});
