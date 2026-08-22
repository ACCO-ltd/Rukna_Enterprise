import { ConflictException, NotFoundException } from '@nestjs/common';

import { BankAccountSignatoryService } from './bank-account-signatory.service.js';

const identity = { userId: 'admin', activeOrganizationId: 'o1' } as never;

function build(over: {
  account?: unknown;
  user?: unknown;
  existingSignatory?: unknown;
  activeCount?: number;
} = {}) {
  const user = 'user' in over ? over.user : { id: 'u1', organizationId: 'o1' };
  const account = 'account' in over ? over.account : { id: 'bank-1', organizationId: 'o1', allowsPayments: true };
  const prisma = {
    user: { findFirst: jest.fn().mockResolvedValue(user) },
  };
  const tenancy = { getClient: () => prisma } as never;
  const bankRepo = {
    findById: jest.fn().mockResolvedValue(account),
  };
  const repo = {
    findActive: jest.fn().mockResolvedValue(over.existingSignatory ?? null),
    countActive: jest.fn().mockResolvedValue(over.activeCount ?? 0),
    listActive: jest.fn().mockResolvedValue([]),
    add: jest.fn().mockResolvedValue({ id: 'sig-1', userId: 'u1' }),
    deactivate: jest.fn().mockResolvedValue({ count: 1 }),
  };
  const svc = new BankAccountSignatoryService(tenancy, repo as never, bankRepo as never);
  return { svc, repo, bankRepo, prisma };
}

describe('BankAccountSignatoryService', () => {
  it('adds a signatory for a valid bank account and user', async () => {
    const { svc, repo } = build();
    await svc.add(identity, 'bank-1', 'u1');
    expect(repo.add).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bankAccountId: 'bank-1', userId: 'u1', addedBy: 'admin' }),
    );
  });

  it('404s when the bank account does not exist', async () => {
    const { svc } = build({ account: null });
    await expect(svc.add(identity, 'nope', 'u1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the user is not in the organization', async () => {
    const { svc } = build({ user: null });
    await expect(svc.add(identity, 'bank-1', 'ghost')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('conflicts when the user is already an active signatory', async () => {
    const { svc } = build({ existingSignatory: { id: 'sig-1' } });
    await expect(svc.add(identity, 'bank-1', 'u1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('reports an account as under dual control only when it has an active signatory', async () => {
    const withNone = build({ activeCount: 0 });
    const withOne = build({ activeCount: 1 });
    expect(await withNone.svc.requiresDualControl(withNone.prisma as never, 'bank-1')).toBe(false);
    expect(await withOne.svc.requiresDualControl(withOne.prisma as never, 'bank-1')).toBe(true);
  });

  it('confirms an active signatory', async () => {
    const yes = build({ existingSignatory: { id: 'sig-1' } });
    const no = build({ existingSignatory: null });
    expect(await yes.svc.isActiveSignatory(yes.prisma as never, 'bank-1', 'u1')).toBe(true);
    expect(await no.svc.isActiveSignatory(no.prisma as never, 'bank-1', 'u1')).toBe(false);
  });
});
