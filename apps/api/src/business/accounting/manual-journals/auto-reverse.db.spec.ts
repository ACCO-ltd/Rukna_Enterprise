/**
 * G-2 — an accrual that reverses itself (live DB).
 *
 *   AR-J-01  posting a journal with "reverse on" posts its mirror too, dated that day, linked to it;
 *            the accounts net to zero after the reversal date
 *   AR-J-02  the reversal date must fall after the journal; a reversal into a closed period
 *            refuses the whole post, so nothing half-posts
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const accrual = (autoReverseOn?: string) =>
  svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-10',
    description: 'Accrue site electricity',
    currencyCode: 'USD',
    autoReverseOn,
    lines: [
      { accountId: env.accounts.expId, debitAmount: 420 },
      { accountId: env.accounts.revId, creditAmount: 420 },
    ],
  });
const postIt = async (id: string) => {
  await svc.manualJournalService.submit(env.identity, id);
  await svc.manualJournalService.approve(env.identity, { journalId: id, approved: true });
  return svc.manualJournalService.post(env.identity, id);
};

it('AR-J-01: posting posts the mirror too, dated the reversal day and linked to the journal', async () => {
  const draft = await accrual('2025-01-25');
  expect(draft.autoReverseOn?.toISOString().slice(0, 10)).toBe('2025-01-25');
  const result = (await postIt(draft.id)) as { journalEntryId: string; autoReversal?: { journalEntryId: string } };
  expect(result.autoReversal?.journalEntryId).toBeTruthy();
  const reversal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: result.autoReversal!.journalEntryId }, include: { lines: true } });
  expect(reversal).toMatchObject({ status: 'POSTED', reversalOfJournalEntryId: result.journalEntryId, entryPurpose: 'REVERSAL' });
  expect(reversal.accountingDate.toISOString().slice(0, 10)).toBe('2025-01-25');
  expect(reversal.lines.find((l) => l.accountId === env.accounts.expId)?.creditAmount.toFixed(2)).toBe('420.00');
  const net = await prisma.journalLine.aggregate({
    where: { accountId: env.accounts.expId, entry: { organizationId: env.orgId, status: 'POSTED', id: { in: [result.journalEntryId, reversal.id] } } },
    _sum: { debitAmount: true, creditAmount: true },
  });
  expect(Number(net._sum.debitAmount) - Number(net._sum.creditAmount)).toBe(0);
  // A reversed accrual cannot be reversed again by hand.
  await expect(svc.manualJournalService.reverse(env.identity, { journalId: result.journalEntryId, reversalDate: '2025-01-26', reason: 'again' }))
    .rejects.toMatchObject({ status: 409 });
});

it('AR-J-02: the date must follow the journal; a reversal into a closed period refuses the whole post', async () => {
  await expect(accrual('2025-01-10')).rejects.toMatchObject({ response: { errorCode: 'AUTO_REVERSE_DATE_INVALID' } });
  const draft = await accrual(env.periods.closedStart.toISOString().slice(0, 10));
  await expect(postIt(draft.id)).rejects.toBeTruthy();
  const after = await prisma.journalEntry.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true } });
  expect(after.status).toBe('APPROVED');
  expect(after.replacedByJournalEntryId).toBeNull();
  expect(after.lines).toHaveLength(2);
});
