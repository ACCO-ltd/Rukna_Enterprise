/**
 * GL-C — the chart of accounts keeps its shape (live DB).
 *
 *   GL-C-01  adding refuses a taken code (any case), a subtype of another class, and a parent that
 *            is not an active heading of the same class
 *   GL-C-02  editing refuses a loop, turning an account with entries into a heading, and turning a
 *            heading with accounts under it into an account
 *   GL-C-03  an account with a balance stays active; one that holds nothing goes inactive, takes no
 *            entries, and comes back
 *   GL-C-04  an import renames an existing account and changes nothing else
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { AccountService } from '../application/account.service';
import { AccountRepository } from '../infrastructure/account.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let accounts: AccountService;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  accounts = new AccountService({ getClient: () => prisma } as never, new AccountRepository());
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const base = {
  accountClass: 'EXPENSE' as const, accountSubtype: 'ADMINISTRATIVE_EXPENSE' as const, normalBalance: 'DEBIT' as const,
  isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' as const, effectiveFrom: '2025-01-01',
};
const code = (p: Promise<unknown>) => p.then(() => 'saved', (e: { response?: { errorCode?: string } }) => e.response?.errorCode);

it('GL-C-01: adding keeps codes unique, subtypes in their class, parents headings', async () => {
  await accounts.create(env.identity, { ...base, code: 'GLC-H', name: 'Office costs', isPostingAllowed: false });
  await expect(accounts.create(env.identity, { ...base, code: 'GLC-1', name: 'Stationery', parentAccountCode: 'GLC-H' })).resolves.toBeTruthy();
  expect(await code(accounts.create(env.identity, { ...base, code: 'glc-1', name: 'Dup' }))).toBe('ACCOUNT_CODE_TAKEN');
  expect(await code(accounts.create(env.identity, { ...base, code: 'GLC-2', name: 'Bad', accountClass: 'INCOME', accountSubtype: 'CASH_AND_BANK' }))).toBe('SUBTYPE_NOT_IN_CLASS');
  expect(await code(accounts.create(env.identity, { ...base, code: 'GLC-3', name: 'Under a postable', parentAccountCode: 'GLC-1' }))).toBe('PARENT_NOT_HEADING');
  expect(await code(accounts.create(env.identity, { ...base, code: 'GLC-4', name: 'Asset', accountClass: 'ASSET', accountSubtype: 'OTHER_CURRENT_ASSET', parentAccountCode: 'GLC-H' }))).toBe('PARENT_OTHER_CLASS');
  expect(await code(accounts.create(env.identity, { ...base, code: 'GLC 5', name: 'Spaced' }))).toBe('ACCOUNT_CODE_INVALID');
});

it('GL-C-02: editing refuses a loop and keeps entries and sub-accounts where they show', async () => {
  const top = await accounts.create(env.identity, { ...base, code: 'GLC-T', name: 'Top', isPostingAllowed: false });
  const mid = await accounts.create(env.identity, { ...base, code: 'GLC-M', name: 'Middle', isPostingAllowed: false, parentAccountCode: 'GLC-T' });
  expect(await code(accounts.update(env.identity, top.id, { parentAccountCode: 'GLC-M' }))).toBe('PARENT_CYCLE');
  expect(await code(accounts.update(env.identity, top.id, { isPostingAllowed: true }))).toBe('ACCOUNT_HAS_CHILDREN');
  expect(mid).toBeTruthy();

  // The expense account takes a posted entry, then cannot become a heading.
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-15', description: 'Rent', currencyCode: 'USD',
    lines: [{ accountId: env.accounts.expId, debitAmount: 75 }, { accountId: env.accounts.revId, creditAmount: 75 }],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  await svc.manualJournalService.post(env.identity, draft.id);
  expect(await code(accounts.update(env.identity, env.accounts.expId, { isPostingAllowed: false }))).toBe('ACCOUNT_HAS_ENTRIES');
  expect(await code(accounts.update(env.identity, env.accounts.arId, { isPostingAllowed: false }))).toBe('ACCOUNT_SYSTEM_KEPT');
});

it('GL-C-03: only an empty account goes inactive; inactive takes no entries; it comes back', async () => {
  expect(await code(accounts.setStatus(env.identity, env.accounts.expId, 'INACTIVE'))).toBe('ACCOUNT_HAS_BALANCE');
  expect(await code(accounts.setStatus(env.identity, env.accounts.arId, 'INACTIVE'))).toBe('ACCOUNT_SYSTEM_KEPT');
  const spare = await accounts.create(env.identity, { ...base, code: 'GLC-S', name: 'Spare' });
  await expect(accounts.setStatus(env.identity, spare.id, 'INACTIVE')).resolves.toMatchObject({ status: 'INACTIVE' });
  expect(await code(svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-15', description: 'To an inactive account', currencyCode: 'USD',
    lines: [{ accountId: spare.id, debitAmount: 5 }, { accountId: env.accounts.revId, creditAmount: 5 }],
  }))).toBe('ACCOUNT_INACTIVE');
  await expect(accounts.setStatus(env.identity, spare.id, 'ACTIVE')).resolves.toMatchObject({ status: 'ACTIVE' });

  // A heading with an active account under it stays active.
  expect(await code(accounts.setStatus(env.identity, (await prisma.account.findFirstOrThrow({ where: { organizationId: env.orgId, code: 'GLC-H' } })).id, 'INACTIVE'))).toBe('ACCOUNT_HAS_ACTIVE_CHILDREN');
});

it('GL-C-04: an import renames and changes nothing else', async () => {
  const result = await accounts.importChartOfAccounts(env.identity, [
    { ...base, code: 'GLC-1', name: 'Stationery and printing', accountClass: 'ASSET', accountSubtype: 'OTHER_CURRENT_ASSET', isPostingAllowed: false },
  ]);
  expect(result).toMatchObject({ updated: 1, errors: [] });
  const after = await prisma.account.findFirstOrThrow({ where: { organizationId: env.orgId, code: 'GLC-1' }, include: { versions: { orderBy: { versionNumber: 'desc' } } } });
  expect(after.versions[0]).toMatchObject({ name: 'Stationery and printing', accountClass: 'EXPENSE', isPostingAllowed: true });
  expect(after.versions[1].effectiveTo).not.toBeNull();
});
