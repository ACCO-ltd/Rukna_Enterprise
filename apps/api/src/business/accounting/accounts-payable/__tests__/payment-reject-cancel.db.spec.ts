/**
 * AP-1 — an unposted payment that will not be made (live DB).
 *
 *   PRC-01  a draft payment holds the bill; the AP tie-out still agrees (the bill is owed until the
 *           payment posts), and so does the aging
 *   PRC-02  the person who raised it cannot reject it; someone else can — the bill gets its balance
 *           back, the payment can no longer be approved or posted
 *   PRC-03  the person who raised it can cancel it (no one else can); a posted payment cannot be
 *           cancelled — it is reversed
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { AgingReportService } from '../../finance-home/application/aging-report.service';
import { FinanceHomeRepository } from '../../finance-home/infrastructure/finance-home.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let billId: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = () => env.periods.openStart.toISOString().slice(0, 10);

const outstanding = async () => (await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } })).outstandingAmount.toFixed(2);
const draftPayment = (amount: number) =>
  svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD',
    totalAmount: amount, paymentMethod: 'BANK_TRANSFER', allocations: [{ supplierBillId: billId, amount }],
  } as never);
const apCheck = async () => {
  const report = await svc.reconciliationService.runFullReconciliation(env.identity, { arAccountCode: env.accounts.arCode, apAccountCode: env.accounts.apCode });
  return report.checks.find((c) => c.subledgerType === 'AP')!;
};

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId, supplierInvoiceNumber: `PRC-${Date.now()}`, billDate: day(), dueDate: day(), currencyCode: 'USD',
    lines: [{ description: 'Generator repair', netAmount: 1000, vatAmount: 0, expenseProfileCode: env.postingProfileCode }],
  } as never);
  await svc.supplierBillService.submit(env.identity, bill.id);
  await svc.supplierBillService.approve(other(), bill.id);
  await svc.supplierBillService.post(env.identity, { billId: bill.id });
  billId = bill.id;
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('PRC-01: a draft payment holds the bill, and the tie-out and the aging still agree with the ledger', async () => {
  await draftPayment(600);
  expect(await outstanding()).toBe('400.00');
  const ap = await apCheck();
  expect(ap.glBalance).toBe('1000.00');
  expect(ap.subledgerBalance).toBe('1000.00');
  expect(ap.reconciled).toBe(true);

  const aging = await new AgingReportService({ getClient: () => prisma } as never, new FinanceHomeRepository())
    .report({ ...env.identity, permissions: ['view:accounting'] } as never, 'payables');
  expect(aging.total).toBe('1000.00');
});

it('PRC-02: only someone else can reject it; the bill gets its balance back', async () => {
  const p = await draftPayment(400);
  expect(await outstanding()).toBe('0.00');
  await expect(svc.supplierPaymentService.reject(env.identity, p.id, 'Wrong bank')).rejects.toMatchObject({ status: 403 });
  await expect(svc.supplierPaymentService.reject(other(), p.id, '  ')).rejects.toMatchObject({ status: 400 });
  const r = await svc.supplierPaymentService.reject(other(), p.id, 'Supplier bank details changed');
  expect(r).toMatchObject({ documentStatus: 'REJECTED', rejectedBy: 'second-approver', rejectionReason: 'Supplier bank details changed' });
  expect(await outstanding()).toBe('400.00');
  await expect(svc.supplierPaymentService.approve(other(), p.id)).rejects.toMatchObject({ status: 400 });
  await expect(svc.supplierPaymentService.reject(other(), p.id, 'again')).rejects.toMatchObject({ status: 409 });
  expect((await apCheck()).reconciled).toBe(true);
});

it('PRC-03: the person who raised it can cancel it; a posted payment cannot be cancelled', async () => {
  const p = await draftPayment(100);
  await expect(svc.supplierPaymentService.cancel(other(), p.id, 'Not mine')).rejects.toMatchObject({ status: 403 });
  const c = await svc.supplierPaymentService.cancel(env.identity, p.id, 'Raised twice');
  expect(c).toMatchObject({ documentStatus: 'CANCELLED', cancellationReason: 'Raised twice' });
  expect(await outstanding()).toBe('400.00');

  const paid = await draftPayment(50);
  await svc.supplierPaymentService.approve(other(), paid.id);
  await svc.supplierPaymentService.post(env.identity, { paymentId: paid.id });
  await expect(svc.supplierPaymentService.cancel(env.identity, paid.id, 'Too late')).rejects.toMatchObject({ status: 409 });
  expect(await outstanding()).toBe('350.00');
  expect((await apCheck()).reconciled).toBe(true);
});
