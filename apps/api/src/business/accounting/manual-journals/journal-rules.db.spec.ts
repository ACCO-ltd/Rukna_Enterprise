/**
 * GL-J — a manual journal is checked when it is saved, can be cancelled before it posts, and reads
 * back with the people and journals around it (live DB).
 *
 *   GL-J-01  saving refuses an unbalanced journal, an impossible date, another currency, a heading
 *            and an inactive account — nothing is written
 *   GL-J-02  an unposted journal can be cancelled, with a reason; a posted one cannot (reverse it)
 *   GL-J-03  a reversal cannot be dated before its journal; the view links the two and names the
 *            preparer; the day book lists both with their totals
 *   GL-J-04  an old draft naming a heading is stopped at submit, and the posting engine refuses a
 *            heading whatever reaches it
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let headingId: string;
let inactiveId: string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  const mk = async (code: string, isPostingAllowed: boolean, status: 'ACTIVE' | 'INACTIVE') => {
    const a = await prisma.account.create({
      data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'DEBIT', status, createdBy: env.identity.userId },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: a.id, versionNumber: 1, name: `${code} Account`, accountClass: 'EXPENSE', accountSubtype: 'ADMINISTRATIVE_EXPENSE',
        isPostingAllowed, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2025-01-01'), changedBy: env.identity.userId,
      },
    });
    return a.id;
  };
  headingId = await mk('HEAD-TEST', false, 'ACTIVE');
  inactiveId = await mk('OLD-TEST', true, 'INACTIVE');
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const journal = (over: Record<string, unknown> = {}, debitAccount?: string) =>
  svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-15',
    description: 'Accrue site rent',
    currencyCode: 'USD',
    lines: [
      { accountId: debitAccount ?? env.accounts.expId, debitAmount: 250 },
      { accountId: env.accounts.revId, creditAmount: 250 },
    ],
    ...over,
  });
const postIt = async (id: string) => {
  await svc.manualJournalService.submit(env.identity, id);
  await svc.manualJournalService.approve(env.identity, { journalId: id, approved: true });
  return svc.manualJournalService.post(env.identity, id) as Promise<{ journalEntryId: string; journalNumber: string }>;
};
const code = (p: Promise<unknown>) => p.then(() => 'saved', (e: { response?: { errorCode?: string } }) => e.response?.errorCode);

it('GL-J-01: saving refuses what could never post, and writes nothing', async () => {
  const before = await prisma.journalEntry.count({ where: { organizationId: env.orgId } });
  expect(await code(journal({ lines: [{ accountId: env.accounts.expId, debitAmount: 100 }, { accountId: env.accounts.revId, creditAmount: 90 }] }))).toBe('JOURNAL_UNBALANCED');
  expect(await code(journal({ accountingDate: '2025-02-31' }))).toBe('JOURNAL_DATE_INVALID');
  expect(await code(journal({ currencyCode: 'EUR' }))).toBe('CURRENCY_NOT_SUPPORTED');
  expect(await code(journal({}, headingId))).toBe('ACCOUNT_NOT_POSTABLE');
  expect(await code(journal({}, inactiveId))).toBe('ACCOUNT_INACTIVE');
  expect(await code(journal({}, env.accounts.ctrlId))).toBe('ACCOUNT_SYSTEM_ONLY');
  expect(await code(journal({}, 'no-such-account'))).toBe('ACCOUNT_NOT_FOUND');
  expect(await prisma.journalEntry.count({ where: { organizationId: env.orgId } })).toBe(before);
});

it('GL-J-02: an unposted journal is cancelled with a reason; a posted one is reversed instead', async () => {
  const draft = await journal();
  await expect(svc.manualJournalService.cancel(env.identity, draft.id, '  ')).rejects.toMatchObject({ response: { errorCode: 'REASON_REQUIRED' } });
  const cancelled = await svc.manualJournalService.cancel(env.identity, draft.id, 'Raised twice');
  expect(cancelled).toMatchObject({ status: 'CANCELLED', cancellationReason: 'Raised twice', cancelledBy: env.identity.userId });
  await expect(svc.manualJournalService.submit(env.identity, draft.id)).rejects.toMatchObject({ status: 404 });
  await expect(svc.manualJournalService.cancel(env.identity, draft.id, 'again')).rejects.toMatchObject({ response: { errorCode: 'JOURNAL_NOT_CANCELLABLE' } });

  const approved = await journal();
  await svc.manualJournalService.submit(env.identity, approved.id);
  await svc.manualJournalService.approve(env.identity, { journalId: approved.id, approved: true });
  await expect(svc.manualJournalService.cancel(env.identity, approved.id, 'Period closed before it posted')).resolves.toMatchObject({ status: 'CANCELLED' });

  const posted = await postIt((await journal()).id);
  await expect(svc.manualJournalService.cancel(env.identity, posted.journalEntryId, 'no')).rejects.toMatchObject({ response: { errorCode: 'JOURNAL_NOT_CANCELLABLE' } });
});

it('GL-J-03: a reversal follows its journal; the view links both; the day book lists both', async () => {
  const posted = await postIt((await journal()).id);
  await expect(
    svc.manualJournalService.reverse(env.identity, { journalId: posted.journalEntryId, reversalDate: '2025-01-10', reason: 'Wrong account' }),
  ).rejects.toMatchObject({ response: { errorCode: 'REVERSAL_BEFORE_JOURNAL' } });
  const reversal = (await svc.manualJournalService.reverse(env.identity, { journalId: posted.journalEntryId, reversalDate: '2025-01-20', reason: 'Wrong account' })) as { journalEntryId: string };

  const view = await svc.manualJournalService.findById(env.identity, posted.journalEntryId);
  expect(view.reversals.map((r) => r.id)).toEqual([reversal.journalEntryId]);
  expect(view.preparedBy).toBe(env.identity.userId);
  expect(view.reversedBy).toBe(env.identity.userId);
  const mirror = await svc.manualJournalService.findById(env.identity, reversal.journalEntryId);
  expect(mirror.reversalOf?.id).toBe(posted.journalEntryId);

  const book = await svc.manualJournalService.entries(env.identity, '2025-01-01', '2025-01-31');
  const mine = book.filter((e) => [posted.journalEntryId, reversal.journalEntryId].includes(e.id));
  expect(mine.map((e) => e.totalAmount)).toEqual(['250.00', '250.00']);
  // The posted journal's authoring row (empty, replaced) is not a second entry.
  expect(book.every((e) => e.journalNumber)).toBe(true);
  await expect(svc.manualJournalService.entries(env.identity, '2025-01-31', '2025-01-01')).rejects.toMatchObject({ response: { errorCode: 'DATE_RANGE_INVALID' } });
});

it('GL-J-04: an old draft on a heading stops at submit; the engine refuses a heading whatever reaches it', async () => {
  const draft = await journal();
  // A draft written before these rules: its debit line points at the heading.
  await prisma.journalLine.updateMany({ where: { journalEntryId: draft.id, accountId: env.accounts.expId }, data: { accountId: headingId } });
  await expect(svc.manualJournalService.submit(env.identity, draft.id)).rejects.toMatchObject({ response: { errorCode: 'ACCOUNT_NOT_POSTABLE' } });

  await prisma.journalEntry.update({ where: { id: draft.id }, data: { status: 'APPROVED' } });
  await expect(svc.manualJournalService.post(env.identity, draft.id)).rejects.toMatchObject({ response: { errorCode: 'ACCOUNT_NOT_POSTABLE' } });
  expect(await prisma.journalEntry.count({ where: { organizationId: env.orgId, status: 'POSTED', lines: { some: { accountId: headingId } } } })).toBe(0);
});
