/**
 * B-1 — managing bank accounts (live DB).
 *
 *   BA-01  the list carries each account's ledger balance and how far it is reconciled
 *   BA-02  details can be corrected; a suspended account takes no new payment; reactivated, it does
 *   BA-03  closing needs a zero balance; a closed account is final
 *   BA-04  a new account: USD only, over an open cash-and-bank GL account not already used, with a
 *          number no other account has (in any letter case)
 *   BA-05  a transfer waiting for approval stops the account closing; one account reads with its figures
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { BankAccountService } from '../application/bank-account.service';
import { AccountRepository } from '../infrastructure/account.repository';
import { BankAccountRepository } from '../infrastructure/bank-account.repository';
import { transferProof } from '../../__tests__/helpers/payment-proof';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let banks: BankAccountService;
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const pay = () =>
  svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD', totalAmount: 10, paymentMethod: 'BANK_TRANSFER',
  } as never);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  banks = new BankAccountService({ getClient: () => prisma } as never, new BankAccountRepository(), new AccountRepository());
  await svc.customerReceiptService.receive(env.identity, {
    ...transferProof(),
    clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: day(), amount: '1250.00', currency: 'USD', allocations: [],
  });
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('BA-01: the list carries the ledger balance and the last reconciled date', async () => {
  const list = await banks.findAll(env.identity);
  const bank = list.find((b) => b.id === env.bankAccountId)!;
  expect(bank.bookBalance).toBe('1250.00');
  expect(bank.lastReconciledTo).toBeNull();
});

it('BA-02: details can be corrected; a suspended account takes no new payment', async () => {
  const updated = await banks.update(env.identity, env.bankAccountId, { accountName: '  Main account  ', allowsReceipts: true });
  expect(updated.accountName).toBe('Main account');
  await expect(banks.update(env.identity, env.bankAccountId, { bankName: ' ' })).rejects.toMatchObject({ status: 400 });

  await banks.setStatus(env.identity, env.bankAccountId, 'SUSPENDED');
  await expect(pay()).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_NOT_PAYING' } });
  await banks.setStatus(env.identity, env.bankAccountId, 'ACTIVE');
  await expect(pay()).resolves.toMatchObject({ documentStatus: 'DRAFT' });
});

it('BA-03: closing needs a zero balance and nothing waiting; a closed account is final', async () => {
  await expect(banks.setStatus(env.identity, env.bankAccountId, 'CLOSED')).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_HAS_BALANCE' } });

  // A second, empty account.
  const gl = await prisma.account.create({ data: { id: `${env.orgId}-10900`, organizationId: env.orgId, code: '10900', normalBalance: 'DEBIT', createdBy: env.identity.userId } });
  await prisma.accountVersion.create({
    data: { accountId: gl.id, versionNumber: 1, name: 'Old account', accountClass: 'ASSET', accountSubtype: 'CASH_AND_BANK', isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
  });
  const empty = await banks.configure(env.identity, { accountName: 'Old account', bankName: 'Any Bank', accountNumber: 'OLD-1', currencyCode: 'USD', glAccountCode: '10900', allowsReceipts: true, allowsPayments: true });
  const closed = await banks.setStatus(env.identity, empty.id, 'CLOSED');
  expect(closed.status).toBe('CLOSED');
  expect(closed.closedAt).not.toBeNull();
  await expect(banks.setStatus(env.identity, empty.id, 'ACTIVE')).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_CLOSED' } });
  await expect(banks.update(env.identity, empty.id, { accountName: 'x' })).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_CLOSED' } });
});

it('BA-04: a new account is USD, over an open cash GL account not yet used, with its own number', async () => {
  const gl = await prisma.account.create({ data: { id: `${env.orgId}-10910`, organizationId: env.orgId, code: '10910', normalBalance: 'DEBIT', createdBy: env.identity.userId } });
  await prisma.accountVersion.create({
    data: { accountId: gl.id, versionNumber: 1, name: 'EVC float', accountClass: 'ASSET', accountSubtype: 'CASH_AND_BANK', isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
  });
  const body = { accountName: 'EVC float', bankName: 'Hormuud', accountNumber: '615000111', currencyCode: 'USD', glAccountCode: '10910', kind: 'MOBILE_WALLET' as const, allowsReceipts: true, allowsPayments: true };
  const refused = (over: object) => banks.configure(env.identity, { ...body, ...over });

  await expect(refused({ currencyCode: 'EUR' })).rejects.toMatchObject({ response: { errorCode: 'CURRENCY_NOT_SUPPORTED' } });
  await expect(refused({ accountName: '  ' })).rejects.toMatchObject({ response: { errorCode: 'FIELD_REQUIRED', field: 'accountName' } });
  await expect(refused({ glAccountCode: env.accounts.apCode })).rejects.toMatchObject({ response: { errorCode: 'GL_ACCOUNT_NOT_CASH' } });
  await expect(refused({ glAccountCode: env.accounts.bankCode })).rejects.toMatchObject({ response: { errorCode: 'GL_ACCOUNT_ALREADY_LINKED' } });
  const existing = await prisma.bankAccount.findUniqueOrThrow({ where: { id: env.bankAccountId } });
  await expect(refused({ accountNumber: ` ${existing.accountNumber.toLowerCase()} ` })).rejects.toMatchObject({ response: { errorCode: 'ACCOUNT_NUMBER_TAKEN' } });
  await prisma.account.update({ where: { id: gl.id }, data: { status: 'INACTIVE' } });
  await expect(refused({})).rejects.toMatchObject({ response: { errorCode: 'GL_ACCOUNT_NOT_POSTABLE' } });
  await prisma.account.update({ where: { id: gl.id }, data: { status: 'ACTIVE' } });

  const made = await refused({ accountName: ' EVC float ', currencyCode: 'usd' });
  expect(made).toMatchObject({ accountName: 'EVC float', currencyCode: 'USD', kind: 'MOBILE_WALLET' });
});

it('BA-05: a transfer waiting for approval stops the account closing; the account page reads its figures', async () => {
  const wallet = await prisma.bankAccount.findFirstOrThrow({ where: { organizationId: env.orgId, accountNumber: '615000111' } });
  const pending = await prisma.bankTransfer.create({
    data: { organizationId: env.orgId, fromBankAccountId: env.bankAccountId, toBankAccountId: wallet.id, amount: 5000, currencyCode: 'USD', transferDate: new Date(day()), requestedBy: env.identity.userId },
  });
  await expect(banks.setStatus(env.identity, wallet.id, 'CLOSED')).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_HAS_PENDING', details: { pending: 1 } } });
  await prisma.bankTransfer.update({ where: { id: pending.id }, data: { status: 'REJECTED' } });

  const view = await banks.view(env.identity, env.bankAccountId);
  expect(view).toMatchObject({ id: env.bankAccountId, bookBalance: expect.any(String), lastReconciledTo: null, lastStatementBalance: null });
});
