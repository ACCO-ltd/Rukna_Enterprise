/**
 * B-2 — moving money between the organisation's own accounts (live DB).
 *
 *   BT-01  up to the payment limit it posts at once: Dr the receiving GL / Cr the sending GL
 *   BT-02  above the limit it waits; the requester cannot approve, someone else can; reject needs a reason
 *   BT-03  refused: the same account, a receiver that takes no money in; a reversal mirrors the journal
 *   BT-04  a date that is not a real day is refused (not rolled over); a reversal cannot predate the
 *          transfer; the view names the journals
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { BankTransferService } from '../application/bank-transfer.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let transfers: BankTransferService;
let cashBoxId: string;
let cashGlId: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const glBalance = async (accountId: string) => {
  const s = await prisma.journalLine.aggregate({ where: { accountId, entry: { status: 'POSTED' } }, _sum: { debitAmount: true, creditAmount: true } });
  return Number(s._sum.debitAmount ?? 0) - Number(s._sum.creditAmount ?? 0);
};

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  transfers = new BankTransferService({ getClient: () => prisma } as never, svc.sequenceRepo, svc.postingService as never);
  const gl = await prisma.account.create({ data: { id: `${env.orgId}-10900`, organizationId: env.orgId, code: '10900', normalBalance: 'DEBIT', createdBy: env.identity.userId } });
  await prisma.accountVersion.create({
    data: { accountId: gl.id, versionNumber: 1, name: 'Site cash box', accountClass: 'ASSET', accountSubtype: 'CASH_AND_BANK', isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
  });
  const box = await prisma.bankAccount.create({
    data: { organizationId: env.orgId, glAccountId: gl.id, bankName: 'Cash', accountName: 'Site cash box', accountNumber: 'CASH-1', currencyCode: 'USD', createdBy: env.identity.userId },
  });
  cashBoxId = box.id;
  cashGlId = gl.id;
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('BT-01: up to the payment limit it posts at once — Dr cash box / Cr bank', async () => {
  const t = await transfers.request(env.identity, { fromBankAccountId: env.bankAccountId, toBankAccountId: cashBoxId, amount: '400.00', transferDate: day(), memo: 'Site petty cash' });
  expect(t.status).toBe('POSTED');
  expect(t.transferNumber).toMatch(/^TR-/);
  expect(t).toMatchObject({ fromAccountName: expect.any(String), toAccountName: 'Site cash box' });
  expect(await glBalance(cashGlId)).toBe(400);
  expect(await glBalance(env.accounts.bankId)).toBe(-400);
});

it('BT-02: above the limit it waits; only someone else approves; reject needs a reason', async () => {
  const big = await transfers.request(env.identity, { fromBankAccountId: env.bankAccountId, toBankAccountId: cashBoxId, amount: '5000.00', transferDate: day() });
  expect(big.status).toBe('PENDING_APPROVAL');
  expect(await glBalance(cashGlId)).toBe(400);
  await expect(transfers.approve(env.identity, big.id)).rejects.toMatchObject({ status: 403 });
  const approved = await transfers.approve(other(), big.id);
  expect(approved).toMatchObject({ status: 'POSTED', approvedByName: null });
  expect(await glBalance(cashGlId)).toBe(5400);

  const second = await transfers.request(env.identity, { fromBankAccountId: env.bankAccountId, toBankAccountId: cashBoxId, amount: '2000.00', transferDate: day() });
  await expect(transfers.reject(other(), second.id, ' ')).rejects.toMatchObject({ status: 400 });
  expect((await transfers.reject(other(), second.id, 'Not needed this week')).status).toBe('REJECTED');
});

it('BT-03: refuses the same account and a receiver that takes nothing in; a reversal mirrors it', async () => {
  await expect(transfers.request(env.identity, { fromBankAccountId: cashBoxId, toBankAccountId: cashBoxId, amount: '1.00', transferDate: day() }))
    .rejects.toMatchObject({ response: { errorCode: 'TRANSFER_SAME_ACCOUNT' } });
  await prisma.bankAccount.update({ where: { id: cashBoxId }, data: { allowsReceipts: false } });
  await expect(transfers.request(env.identity, { fromBankAccountId: env.bankAccountId, toBankAccountId: cashBoxId, amount: '1.00', transferDate: day() }))
    .rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_NOT_RECEIVING' } });
  await prisma.bankAccount.update({ where: { id: cashBoxId }, data: { allowsReceipts: true } });

  const [first] = (await transfers.list(env.identity, cashBoxId)).filter((t) => t.status === 'POSTED' && t.amount === '400.00');
  const back = await transfers.reverse(env.identity, first!.id, { reversalDate: day(), reason: 'Recorded twice' });
  expect(back.status).toBe('REVERSED');
  expect(await glBalance(cashGlId)).toBe(5000);
  await expect(transfers.reverse(env.identity, first!.id, { reversalDate: day(), reason: 'again' })).rejects.toMatchObject({ status: 409 });
});

it('BT-04: real dates only; a reversal cannot predate the transfer; the view names its journals', async () => {
  await expect(transfers.request(env.identity, { fromBankAccountId: env.bankAccountId, toBankAccountId: cashBoxId, amount: '5.00', transferDate: '2026-02-31' }))
    .rejects.toMatchObject({ response: { errorCode: 'TRANSFER_DATE_INVALID' } });

  const start = env.periods.openStart;
  const later = new Date(start.getTime() + 5 * 86_400_000).toISOString().slice(0, 10);
  const t = await transfers.request(env.identity, { fromBankAccountId: env.bankAccountId, toBankAccountId: cashBoxId, amount: '5.00', transferDate: later });
  expect(t).toMatchObject({ status: 'POSTED', journalEntryId: expect.any(String), reversalJournalEntryId: null, postedAt: expect.any(String) });
  await expect(transfers.reverse(env.identity, t.id, { reversalDate: day(), reason: 'Wrong day' }))
    .rejects.toMatchObject({ response: { errorCode: 'REVERSAL_BEFORE_TRANSFER' } });
  const back = await transfers.reverse(env.identity, t.id, { reversalDate: later, reason: 'Never moved' });
  expect(back).toMatchObject({ status: 'REVERSED', reversalJournalEntryId: expect.any(String), reversedAt: expect.any(String) });
});
