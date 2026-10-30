/**
 * B-1 — managing bank accounts (live DB).
 *
 *   BA-01  the list carries each account's ledger balance and how far it is reconciled
 *   BA-02  details can be corrected; a suspended account takes no new payment; reactivated, it does
 *   BA-03  closing needs a zero balance; a closed account is final
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
