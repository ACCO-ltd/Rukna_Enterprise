/**
 * AR-4 — writing off a client balance (live DB). Owner decision 2026-10-29: up to $50 posts at
 * once; above it a second person approves.
 *
 *   WO-01  without a Bad debts account the write-off is refused with a coded error
 *   WO-02  up to the limit: posts at once — Dr Bad debts / Cr AR, numbered, the balance falls
 *   WO-03  above the limit: waits; the requester cannot approve, someone else can (it posts);
 *          a waiting write-off counts against the balance; reject records why
 *   WO-04  reversing restores the balance; the statement shows the write-off and its reversal
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository';
import { WriteOffService } from '../application/write-off.service';
import { ClientStatementService } from '../application/client-statement.service';
import { ClientStatementRepository } from '../infrastructure/client-statement.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let writeOffs: WriteOffService;
let invoiceId: string;
let badDebtsId: string;
let day: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });

async function account(code: string, name: string, accountClass: 'INCOME' | 'LIABILITY' | 'EXPENSE', subtype: string) {
  const a = await prisma.account.create({
    data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: accountClass === 'EXPENSE' ? 'DEBIT' : 'CREDIT', createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype as never, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
  });
  return a.id;
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  writeOffs = new WriteOffService({ getClient: () => prisma } as never, svc.sequenceRepo, new PostingAccountResolver(new AccountRepository()), svc.postingService as never);
  await account('42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME');
  day = env.periods.openStart.toISOString().slice(0, 10);
  const inv = await svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId, invoiceDate: day, dueDate: day, currencyCode: 'USD', paymentTerms: 'Due on receipt',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: '1000.00', revenueAccountCode: '42100' }],
  });
  await svc.clientInvoiceService.issue(env.identity, inv.id); // 1050 with 5% tax
  invoiceId = inv.id;
}, 90_000);

afterAll(async () => {
  await prisma.receivableWriteOff.deleteMany({ where: { organizationId: env.orgId } });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const outstanding = async () => (await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoiceId } })).outstandingAmount.toFixed(2);

it('WO-01: without a Bad debts account the write-off is refused with a coded error', async () => {
  await expect(
    writeOffs.request(env.identity, { invoiceId, amount: '3.00', reason: 'SMALL_BALANCE', accountingDate: day }),
  ).rejects.toMatchObject({ response: { errorCode: 'BAD_DEBT_ACCOUNT_NOT_CONFIGURED' } });
  // Nothing is left waiting.
  expect(await prisma.receivableWriteOff.count({ where: { organizationId: env.orgId } })).toBe(0);
  badDebtsId = await account('67000', 'Bad debts', 'EXPENSE', 'BAD_DEBT_EXPENSE');
});

it('WO-02: up to the limit it posts at once — Dr Bad debts / Cr AR — and the balance falls', async () => {
  const w = await writeOffs.request(env.identity, { invoiceId, amount: '50.00', reason: 'SMALL_BALANCE', accountingDate: day });
  expect(w.status).toBe('POSTED');
  expect(w.writeOffNumber).toMatch(/^WO-/);
  const row = await prisma.receivableWriteOff.findUniqueOrThrow({ where: { id: w.id } });
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: row.postedJournalEntryId! } });
  expect(lines.find((l) => l.accountId === badDebtsId)?.debitAmount.toFixed(2)).toBe('50.00');
  expect(lines.find((l) => l.accountId === env.accounts.arId)?.creditAmount.toFixed(2)).toBe('50.00');
  expect(lines.every((l) => l.clientId === env.clientId)).toBe(true);
  expect(await outstanding()).toBe('1000.00');
});

it('WO-03: above the limit it waits; the requester cannot approve; someone else can', async () => {
  const w = await writeOffs.request(env.identity, { invoiceId, amount: '600.00', reason: 'BAD_DEBT', accountingDate: day, note: 'Client in liquidation' });
  expect(w.status).toBe('PENDING_APPROVAL');
  expect(await outstanding()).toBe('1000.00');
  // A waiting write-off counts against the balance.
  await expect(
    writeOffs.request(env.identity, { invoiceId, amount: '500.00', reason: 'BAD_DEBT', accountingDate: day }),
  ).rejects.toMatchObject({ response: { errorCode: 'WRITE_OFF_EXCEEDS_BALANCE', details: { available: '400.00' } } });
  await expect(writeOffs.approve(env.identity, w.id)).rejects.toMatchObject({ response: { errorCode: 'WRITE_OFF_SELF_APPROVAL' } });
  const approved = await writeOffs.approve(other(), w.id);
  expect(approved.status).toBe('POSTED');
  expect(await outstanding()).toBe('400.00');

  const rejected = await writeOffs.request(env.identity, { invoiceId, amount: '100.00', reason: 'BAD_DEBT', accountingDate: day });
  const r = await writeOffs.reject(other(), rejected.id, 'Chase them first');
  expect([r.status, r.rejectionReason]).toEqual(['REJECTED', 'Chase them first']);
  expect(await outstanding()).toBe('400.00');
});

it('WO-04: reversing restores the balance; the statement shows the write-off and its reversal', async () => {
  const [first] = await writeOffs.listForInvoice(env.identity, invoiceId);
  const reversed = await writeOffs.reverse(env.identity, first!.id, { reversalDate: day, reason: 'Client paid after all' });
  expect(reversed.status).toBe('REVERSED');
  expect(await outstanding()).toBe('450.00');

  const statements = new ClientStatementService({ getClient: () => prisma } as never, new ClientStatementRepository());
  const s = await statements.statement(env.identity, env.clientId, day, day);
  expect(s.lines.filter((l) => l.kind === 'WRITE_OFF')).toHaveLength(2);
  expect(s.lines.filter((l) => l.kind === 'WRITE_OFF_REVERSAL')).toHaveLength(1);
  expect(s.closingBalance).toBe('450.00');
});
