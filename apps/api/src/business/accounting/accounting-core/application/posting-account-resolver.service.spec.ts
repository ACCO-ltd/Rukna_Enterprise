import { BadRequestException } from '@nestjs/common';

import { PostingAccountResolver } from './posting-account-resolver.service.js';

function account(id: string, code: string, subtype: string, status = 'ACTIVE') {
  return { id, code, status, versions: [{ accountSubtype: subtype }] };
}

function build(accounts: unknown[]) {
  const accountRepo = {
    findAll: jest.fn().mockResolvedValue(accounts),
    findByCode: jest.fn((_p: unknown, _o: string, code: string) => {
      const found = (accounts as { code: string }[]).find((a) => a.code === code);
      return Promise.resolve(found ?? null);
    }),
  };
  return { resolver: new PostingAccountResolver(accountRepo as never), accountRepo };
}

describe('PostingAccountResolver (ADR-024 ACC-POST-001)', () => {
  it('resolves the single active account carrying the role subtype', async () => {
    const { resolver } = build([
      account('a1', 'AR-001', 'ACCOUNTS_RECEIVABLE'),
      account('a2', 'REV-001', 'PROJECT_REVENUE'),
    ]);
    await expect(resolver.resolve({} as never, 'org-1', 'ACCOUNTS_RECEIVABLE' as never)).resolves.toEqual({
      id: 'a1',
      code: 'AR-001',
    });
  });

  it('throws NOT_CONFIGURED when no account carries the subtype', async () => {
    const { resolver } = build([account('a2', 'REV-001', 'PROJECT_REVENUE')]);
    await expect(
      resolver.resolve({} as never, 'org-1', 'ACCOUNTS_RECEIVABLE' as never),
    ).rejects.toThrow(/POSTING_ACCOUNT_NOT_CONFIGURED/);
  });

  it('throws AMBIGUOUS when more than one account carries the subtype', async () => {
    const { resolver } = build([
      account('a1', 'AR-001', 'ACCOUNTS_RECEIVABLE'),
      account('a3', 'AR-002', 'ACCOUNTS_RECEIVABLE'),
    ]);
    await expect(
      resolver.resolve({} as never, 'org-1', 'ACCOUNTS_RECEIVABLE' as never),
    ).rejects.toThrow(/POSTING_ACCOUNT_AMBIGUOUS/);
  });

  it('ignores inactive accounts', async () => {
    const { resolver } = build([account('a1', 'AR-OLD', 'ACCOUNTS_RECEIVABLE', 'INACTIVE')]);
    await expect(
      resolver.resolve({} as never, 'org-1', 'ACCOUNTS_RECEIVABLE' as never),
    ).rejects.toThrow(BadRequestException);
  });

  it('resolveByCodeOrRole honours an explicit code override', async () => {
    const { resolver } = build([
      account('a1', 'AR-001', 'ACCOUNTS_RECEIVABLE'),
      account('a9', 'AR-SPECIAL', 'ACCOUNTS_RECEIVABLE'),
    ]);
    // Two AR accounts would be AMBIGUOUS by role, but an explicit code resolves unambiguously.
    await expect(
      resolver.resolveByCodeOrRole({} as never, 'org-1', 'AR-SPECIAL', 'ACCOUNTS_RECEIVABLE' as never),
    ).resolves.toEqual({ id: 'a9', code: 'AR-SPECIAL' });
  });
});
