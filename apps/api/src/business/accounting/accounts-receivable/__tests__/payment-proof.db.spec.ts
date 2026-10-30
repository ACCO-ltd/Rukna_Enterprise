/**
 * PM — a receipt's payment method and the proof behind it (live DB).
 *
 *   PM-01  the method is required, and each method's proof: missing fields are listed, a sender's
 *          phone and a card's last 4 digits are checked
 *   PM-02  the same proof cannot pay twice (a bank's name in any case is one bank); a reversed or
 *          cancelled receipt frees it, so a bounced cheque can be presented again
 *   PM-03  cash lands only in a cash box, mobile money only in a wallet, the rest in a bank account;
 *          a sender's phone is stored in +252 form
 *   PM-04  a cheque dated after the day it is received is held on hand, and posts when deposited,
 *          on or after the cheque date, dated the deposit day
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let cashBoxId: string;
let walletId: string;

const day = (offset = 0) => new Date(env.periods.openStart.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
const base = (patch: Record<string, unknown>) => ({
  clientId: env.clientId,
  bankAccountId: env.bankAccountId,
  receiptDate: day(),
  amount: '100.00',
  currency: 'USD',
  allocations: [],
  ...patch,
});
const receive = (patch: Record<string, unknown>) => svc.customerReceiptService.receive(env.identity, base(patch) as never);
const cheque = (patch: Record<string, unknown> = {}) => ({
  paymentMethod: 'CHEQUE',
  instrumentNumber: '118204',
  issuer: 'Premier Bank',
  instrumentDate: day(),
  payerName: 'Water Agency',
  ...patch,
});

async function moneyAccount(code: string, name: string, kind: 'CASH' | 'MOBILE_WALLET') {
  const gl = await prisma.account.create({
    data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'DEBIT', createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: {
      accountId: gl.id, versionNumber: 1, name, accountClass: 'ASSET', accountSubtype: 'CASH_AND_BANK',
      isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId,
    },
  });
  const bank = await prisma.bankAccount.create({
    data: {
      organizationId: env.orgId, glAccountId: gl.id, bankName: name, accountName: name, accountNumber: code,
      currencyCode: 'USD', kind, allowsReceipts: true, allowsPayments: true, status: 'ACTIVE', createdBy: env.identity.userId,
    },
  });
  return bank.id;
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  cashBoxId = await moneyAccount('CASH-BOX', 'Site cash box', 'CASH');
  walletId = await moneyAccount('EVC-WALLET', 'EVC Plus wallet', 'MOBILE_WALLET');
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('PM-01: the method and its proof are required, and checked', async () => {
  await expect(receive({})).rejects.toMatchObject({ response: { errorCode: 'PAYMENT_METHOD_REQUIRED' } });
  await expect(receive({ paymentMethod: 'CHEQUE' })).rejects.toMatchObject({
    response: {
      errorCode: 'PAYMENT_DETAILS_INVALID',
      message: 'Enter the cheque number, the bank the cheque is drawn on, the cheque date, the name on the cheque.',
    },
  });
  await expect(
    receive({ paymentMethod: 'MOBILE_MONEY', bankAccountId: walletId, issuer: 'EVC_PLUS', payerAccount: '12', instrumentNumber: 'X1' }),
  ).rejects.toMatchObject({ response: { message: "The sender's phone number is not a valid number." } });
  await expect(
    receive({ paymentMethod: 'MOBILE_MONEY', bankAccountId: walletId, issuer: 'MPESA', payerAccount: '615555555', instrumentNumber: 'X1' }),
  ).rejects.toMatchObject({ response: { message: 'Choose a mobile-money provider from the list.' } });
  await expect(
    receive({ paymentMethod: 'CARD', issuer: 'VISA', payerAccount: '4242424242424242', instrumentNumber: 'A1' }),
  ).rejects.toMatchObject({ response: { message: 'Enter exactly the last 4 digits of the card.' } });
  expect(await prisma.paymentReceipt.count({ where: { organizationId: env.orgId } })).toBe(0);
});

it('PM-02: the same proof cannot pay twice until its receipt is reversed or cancelled', async () => {
  const first = await receive(cheque({ instrumentNumber: 'chq-555' }));
  expect(first.instrumentNumber).toBe('CHQ-555');

  await expect(receive(cheque({ instrumentNumber: 'CHQ-555', issuer: 'premier bank' }))).rejects.toMatchObject({
    response: { errorCode: 'PAYMENT_PROOF_ALREADY_USED', message: `Cheque CHQ-555 (premier bank) is already on ${first.receiptNumber}.` },
  });
  // Another bank's cheque 555 is another cheque.
  const other = await receive(cheque({ instrumentNumber: 'CHQ-555', issuer: 'Dahabshil Bank' }));
  expect(other.postingStatus).toBe('POSTED');

  // Bounced: reversed, then presented again.
  await svc.customerReceiptService.reverse(env.identity, first.id, { reversalDate: day(), reason: 'Cheque bounced' });
  const again = await receive(cheque({ instrumentNumber: 'CHQ-555' }));
  expect(again.postingStatus).toBe('POSTED');

  // A cancelled (never posted) receipt frees its proof too.
  const held = await svc.customerReceiptService.create(env.identity, {
    clientId: env.clientId, receiptDate: day(), amount: '10.00', currency: 'USD',
    paymentMethod: 'CASH', instrumentNumber: 'CR-0091', receivedBy: 'Amina',
  } as never);
  await expect(receive({ paymentMethod: 'CASH', bankAccountId: cashBoxId, instrumentNumber: 'cr-0091', receivedBy: 'Amina' })).rejects.toMatchObject({
    response: { message: 'Cash receipt CR-0091 is already on an unposted receipt.' },
  });
  await svc.customerReceiptService.cancel(env.identity, held.id, 'Typed twice');
  await expect(receive({ paymentMethod: 'CASH', bankAccountId: cashBoxId, instrumentNumber: 'CR-0091', receivedBy: 'Amina' })).resolves.toBeTruthy();
});

it('PM-03: each method lands in its own kind of account; phones are stored in +252 form', async () => {
  await expect(receive({ paymentMethod: 'CASH', instrumentNumber: 'CR-1', receivedBy: 'Amina' })).rejects.toMatchObject({
    response: { errorCode: 'BANK_ACCOUNT_WRONG_KIND', message: 'This payment method is received into a cash box; Main Operating is not one.' },
  });
  await expect(receive(cheque({ instrumentNumber: 'W-1', bankAccountId: walletId }))).rejects.toMatchObject({
    response: { errorCode: 'BANK_ACCOUNT_WRONG_KIND' },
  });

  const evc = await receive({
    paymentMethod: 'MOBILE_MONEY', bankAccountId: walletId, issuer: 'EVC_PLUS', payerAccount: '061 5555555', instrumentNumber: '8842213',
  });
  expect(evc).toMatchObject({ payerAccount: '+252615555555', issuer: 'EVC_PLUS', instrumentNumber: '8842213', bankAccountId: walletId });
  // Fields a method does not keep are dropped.
  const cash = await receive({ paymentMethod: 'CASH', bankAccountId: cashBoxId, instrumentNumber: 'CR-2', receivedBy: 'Amina', payerAccount: '0615555555' });
  expect(cash.payerAccount).toBeNull();
});

it('PM-04: a post-dated cheque is held on hand and posts when deposited', async () => {
  const held = await receive(cheque({ instrumentNumber: 'PD-77', instrumentDate: day(10) }));
  expect(held).toMatchObject({ postingStatus: 'NOT_POSTED', receiptNumber: null, bankAccountId: env.bankAccountId });
  expect(held.postedJournalEntryId).toBeNull();

  await expect(
    svc.customerReceiptService.post(env.identity, { receiptId: held.id, bankAccountId: env.bankAccountId, depositDate: day(9) }),
  ).rejects.toMatchObject({ response: { errorCode: 'CHEQUE_NOT_DUE' } });

  await svc.customerReceiptService.post(env.identity, { receiptId: held.id, bankAccountId: env.bankAccountId, depositDate: day(12) });
  const posted = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: held.id } });
  expect(posted.postingStatus).toBe('POSTED');
  expect(posted.accountingDate.toISOString().slice(0, 10)).toBe(day(12));
  const journal = await prisma.journalEntry.findUniqueOrThrow({ where: { id: posted.postedJournalEntryId! } });
  expect(journal.accountingDate.toISOString().slice(0, 10)).toBe(day(12));
});
