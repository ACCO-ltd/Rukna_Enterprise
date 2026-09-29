/**
 * AC — Account edit (PATCH /accounts/:id)
 *
 *   AC-01  rename supersedes the current version, closes the prior one (no exclusion-constraint violation)
 *   AC-02  a no-op edit creates no new version
 *   AC-03  toggling isPostingAllowed carries the other fields forward unchanged
 */

import { PrismaClient } from '@prisma/client';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { AccountService } from '../accounting-core/application/account.service';
import { AccountRepository } from '../accounting-core/infrastructure/account.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountService;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = new AccountService({ getClient: () => prisma } as never, new AccountRepository());
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// ─── AC-01 ────────────────────────────────────────────────────────────────────
it('AC-01: rename supersedes the version and closes the prior one', async () => {
  const before = await prisma.accountVersion.findMany({ where: { accountId: env.accounts.revId } });
  expect(before.length).toBe(1);

  const updated = await svc.update(env.identity, env.accounts.revId, { name: 'Renamed Revenue' });
  expect(updated?.versions[0]?.name).toBe('Renamed Revenue');

  const after = await prisma.accountVersion.findMany({
    where: { accountId: env.accounts.revId },
    orderBy: { versionNumber: 'asc' },
  });
  expect(after.length).toBe(2);
  expect(after[0].effectiveTo).not.toBeNull(); // prior version closed
  expect(after[1].effectiveTo).toBeNull(); // new version open-ended
  expect(after[1].versionNumber).toBe(2);
  expect(after[1].accountClass).toBe(after[0].accountClass); // class carried forward
});

// ─── AC-02 ────────────────────────────────────────────────────────────────────
it('AC-02: a no-op edit creates no new version', async () => {
  const current = await prisma.accountVersion.findFirst({
    where: { accountId: env.accounts.expId },
    orderBy: { versionNumber: 'desc' },
  });
  await svc.update(env.identity, env.accounts.expId, { name: current!.name });
  const count = await prisma.accountVersion.count({ where: { accountId: env.accounts.expId } });
  expect(count).toBe(1);
});

// ─── AC-03 ────────────────────────────────────────────────────────────────────
it('AC-03: toggling isPostingAllowed carries other fields forward', async () => {
  const updated = await svc.update(env.identity, env.accounts.unaplId, { isPostingAllowed: false });
  const v = updated?.versions[0];
  expect(v?.isPostingAllowed).toBe(false);
  expect(v?.accountSubtype).toBe('UNAPPLIED_CLIENT_RECEIPTS'); // unchanged
});
