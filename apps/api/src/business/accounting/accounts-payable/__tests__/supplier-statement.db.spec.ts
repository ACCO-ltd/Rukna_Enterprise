/**
 * AP-3 — a supplier's statement of account (live DB).
 *
 *   SST-01  bills are credits, payments debits; the closing balance is what is owed, and equals the
 *           open bills (counting what unposted payments hold) less payments not yet applied
 *   SST-02  a reversed payment shows twice — paid, then the reversal — and the balance is owed again
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { SupplierStatementService } from '../application/supplier-statement.service';
import { SupplierStatementRepository } from '../infrastructure/supplier-statement.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let statements: SupplierStatementService;
let billId: string;
let paidId: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const sum = (a: Record<string, string>) => Object.values(a).reduce((s, v) => s + Number(v), 0);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  statements = new SupplierStatementService({ getClient: () => prisma } as never, new SupplierStatementRepository());
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId, supplierInvoiceNumber: 'SUP-INV-501', billDate: day(), dueDate: day(), currencyCode: 'USD',
    lines: [{ description: 'Concrete pump', netAmount: 1000, expenseProfileCode: env.postingProfileCode }],
  } as never);
  await svc.supplierBillService.submit(env.identity, bill.id);
  await svc.supplierBillService.approve(other(), bill.id);
  await svc.supplierBillService.post(env.identity, { billId: bill.id });
  billId = bill.id;
  const pay = (amount: number, allocated: number) => svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD', totalAmount: amount,
    paymentMethod: 'BANK_TRANSFER', bankReference: `TT-${Math.random().toString(36).slice(2, 8)}`, allocations: [{ supplierBillId: billId, amount: allocated }],
  } as never);
  const paid = await pay(700, 600); // 600 applied, 100 paid ahead
  await svc.supplierPaymentService.approve(other(), paid.id);
  await svc.supplierPaymentService.post(env.identity, { paymentId: paid.id });
  paidId = paid.id;
  await pay(100, 100); // raised, not posted
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('SST-01: the closing balance is what is owed, and ties to open bills less unapplied payments', async () => {
  const s = await statements.statement(env.identity, env.supplierId, day(), day());
  expect(s.lines.map((l) => [l.kind, l.debit, l.credit, l.balance])).toEqual([
    ['BILL', null, '1000.00', '1000.00'],
    ['PAYMENT', '700.00', null, '300.00'],
  ]);
  expect(s.closingBalance).toBe('300.00');
  expect(sum(s.aging)).toBe(400); // 300 left to pay + 100 held by the unposted payment
  expect(s.unapplied).toBe('100.00');
  expect(s.pendingPayments).toBe('100.00');
  expect(sum(s.aging) - Number(s.unapplied)).toBe(Number(s.closingBalance));
  // SS-1 — the open bill with what settled it and what is still owed (the unposted 100 still counts).
  expect(s.openBills).toEqual([expect.objectContaining({ number: expect.any(String), total: '1000.00', settled: '600.00', balance: '400.00' })]);
});

it('SST-02: a reversed payment shows paid and reversed, and the bill is owed again', async () => {
  await svc.supplierPaymentService.reverse(env.identity, paidId, { reversalDate: day(), reason: 'Bounced' });
  const s = await statements.statement(env.identity, env.supplierId, day(), day());
  expect(s.lines.map((l) => l.kind)).toEqual(['BILL', 'PAYMENT', 'PAYMENT_REVERSAL']);
  expect(s.closingBalance).toBe('1000.00');
  expect(s.unapplied).toBe('0.00');
  expect(sum(s.aging) - Number(s.unapplied)).toBe(1000);
});
