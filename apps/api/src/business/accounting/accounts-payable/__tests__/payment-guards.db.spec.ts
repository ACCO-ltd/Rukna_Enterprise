/**
 * SP-1..SP-3 — supplier payments refuse what would pay a bill twice or leave no trail (live DB).
 *
 *   SP-01  two payments raised at once for the same bill: one settles it, the other is refused
 *   SP-02  an unknown supplier is a 404 (was a 500); an inactive one is paid nothing new; USD only
 *   SP-03  proof is stored in one shape; a cheque number is used once per account while live;
 *          mobile money is paid from a wallet, never a bank account (PN-2)
 *   SP-04  a reversal needs a reason and a date not before the payment, and is recorded
 *   SP-05  two reversals at once give the bill its balance back once
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const nextDay = () => new Date(env.periods.openStart.getTime() + 86_400_000).toISOString().slice(0, 10);

async function postedBill(amount: number) {
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId, supplierInvoiceNumber: `SP-${Math.random().toString(36).slice(2, 9)}`, billDate: day(), dueDate: day(), currencyCode: 'USD',
    lines: [{ description: 'Formwork hire', netAmount: amount, expenseProfileCode: env.postingProfileCode }],
  } as never);
  await svc.supplierBillService.submit(env.identity, bill.id);
  const now = await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
  if (now.documentStatus === 'SUBMITTED') await svc.supplierBillService.approve(other(), bill.id);
  if (now.postingStatus !== 'POSTED') await svc.supplierBillService.post(env.identity, { billId: bill.id, apAccountCode: env.accounts.apCode });
  return bill.id;
}

const pay = (over: Record<string, unknown> = {}) =>
  svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD',
    totalAmount: 100, paymentMethod: 'BANK_TRANSFER', ...over,
  } as never);

const outstanding = async (id: string) =>
  (await prisma.supplierBill.findUniqueOrThrow({ where: { id } })).outstandingAmount.toString();

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('SP-01: two payments at once for one bill — one settles it, the other is refused', async () => {
  const billId = await postedBill(100);
  const results = await Promise.allSettled([1, 2].map(() => pay({ allocations: [{ supplierBillId: billId, amount: 100 }] })));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
  expect(refused.reason).toMatchObject({ status: expect.any(Number) });
  expect(await outstanding(billId)).toBe('0');
  expect(await prisma.supplierPaymentAllocation.count({ where: { supplierBillId: billId } })).toBe(1);
});

it('SP-02: unknown supplier 404; inactive supplier refused; USD only', async () => {
  await expect(pay({ supplierId: 'no-such-supplier' })).rejects.toMatchObject({ status: 404, response: { errorCode: 'SUPPLIER_NOT_FOUND' } });
  await expect(pay({ currencyCode: 'EUR' })).rejects.toMatchObject({ response: { errorCode: 'CURRENCY_NOT_SUPPORTED' } });
  await prisma.supplier.update({ where: { id: env.supplierId }, data: { status: 'INACTIVE' } });
  try {
    await expect(pay()).rejects.toMatchObject({ response: { errorCode: 'SUPPLIER_INACTIVE' } });
  } finally {
    await prisma.supplier.update({ where: { id: env.supplierId }, data: { status: 'ACTIVE' } });
  }
});

it('SP-03: proof is normalised; a cheque number is used once per account while live', async () => {
  const cheque = await pay({ paymentMethod: 'CHEQUE', bankReference: ' chq-004512 ', instrumentDate: day(), payeeName: 'Berbera Cement', payeeAccount: 'dropped' });
  expect(cheque).toMatchObject({ bankReference: 'CHQ-004512', payeeName: 'Berbera Cement', payeeAccount: null });
  await expect(pay({ paymentMethod: 'CHEQUE', bankReference: 'CHQ-004512' })).rejects.toMatchObject({
    status: 409,
    response: { errorCode: 'PAYMENT_REFERENCE_ALREADY_USED' },
  });
  // The same number by transfer is a different instrument.
  await expect(pay({ bankReference: 'CHQ-004512' })).resolves.toBeDefined();
  // Cancelled, the cheque number is free again.
  await svc.supplierPaymentService.cancel(env.identity, cheque.id, 'Cheque spoiled');
  await expect(pay({ paymentMethod: 'CHEQUE', bankReference: 'chq-004512' })).resolves.toBeDefined();

  // Mobile money leaves a wallet (PN-2): refused from the bank account, accepted once it is a wallet.
  await expect(pay({ paymentMethod: 'MOBILE_MONEY' })).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_WRONG_KIND' } });
  await prisma.bankAccount.update({ where: { id: env.bankAccountId }, data: { kind: 'MOBILE_WALLET' } });
  let mobile;
  try {
    mobile = await pay({ paymentMethod: 'MOBILE_MONEY', bankReference: 'tx-77', provider: 'EVC_PLUS', payeeAccount: '0615123456' });
    await expect(pay({ paymentMethod: 'MOBILE_MONEY', provider: 'MPESA' })).rejects.toMatchObject({ response: { errorCode: 'PAYMENT_PROOF_INVALID' } });
  } finally {
    await prisma.bankAccount.update({ where: { id: env.bankAccountId }, data: { kind: 'BANK' } });
  }
  expect(mobile).toMatchObject({ provider: 'EVC_PLUS', payeeAccount: '+252615123456', bankReference: 'TX-77' });
});

async function postedPayment(billId: string) {
  const payment = await pay({ allocations: [{ supplierBillId: billId, amount: 100 }] });
  const now = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } });
  if (now.documentStatus === 'DRAFT') await svc.supplierPaymentService.approve(other(), payment.id);
  await svc.supplierPaymentService.post(env.identity, { paymentId: payment.id, apAccountCode: env.accounts.apCode });
  return payment.id;
}

it('SP-04: a reversal needs a reason and a date not before the payment, and is recorded', async () => {
  const billId = await postedBill(100);
  const paymentId = await postedPayment(billId);
  const before = new Date(env.periods.openStart.getTime() - 86_400_000).toISOString().slice(0, 10);
  await expect(svc.supplierPaymentService.reverse(env.identity, paymentId, { reversalDate: before, reason: 'Returned' }))
    .rejects.toMatchObject({ response: { errorCode: 'REVERSAL_BEFORE_PAYMENT' } });
  await expect(svc.supplierPaymentService.reverse(env.identity, paymentId, { reversalDate: day(), reason: '  ' }))
    .rejects.toMatchObject({ response: { errorCode: 'REASON_REQUIRED' } });
  await svc.supplierPaymentService.reverse(env.identity, paymentId, { reversalDate: nextDay(), reason: 'Transfer returned by the bank' });
  const reversed = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } });
  expect(reversed).toMatchObject({ postingStatus: 'REVERSED', reversalReason: 'Transfer returned by the bank', reversedBy: env.identity.userId });
  expect(reversed.reversalJournalEntryId).toBeTruthy();
  expect(await outstanding(billId)).toBe('100');
});

it('SP-05: two reversals at once give the bill its balance back once', async () => {
  const billId = await postedBill(100);
  const paymentId = await postedPayment(billId);
  const results = await Promise.allSettled([1, 2].map(() =>
    svc.supplierPaymentService.reverse(env.identity, paymentId, { reversalDate: day(), reason: 'Duplicate' })));
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await outstanding(billId)).toBe('100');
});
