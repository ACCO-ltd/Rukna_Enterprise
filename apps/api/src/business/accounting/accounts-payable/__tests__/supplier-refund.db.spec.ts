/**
 * AP-5 — a supplier pays back money paid ahead (live DB).
 *
 *   SR-01  posts at once: Dr the bank / Cr Supplier advance (the account the payment debited); the
 *          payment holds that much less unapplied; the statement shows it and still ties
 *   SR-02  capped at what the payment holds unapplied; a reason is required
 *   SR-03  a payment with a posted refund cannot be reversed; reversing the refund puts the money
 *          back on the payment, and then the payment can be reversed
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository';
import { SupplierRefundService } from '../application/supplier-refund.service';
import { SupplierStatementService } from '../application/supplier-statement.service';
import { SupplierStatementRepository } from '../infrastructure/supplier-statement.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let refunds: SupplierRefundService;
let paymentId: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const unapplied = async () => (await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } })).unallocatedAmount.toFixed(2);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  refunds = new SupplierRefundService({ getClient: () => prisma } as never, svc.sequenceRepo, new PostingAccountResolver(new AccountRepository()), svc.postingService as never);
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });
  // A deposit paid ahead of any bill: 2,000 unapplied, held as a supplier advance.
  const p = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD',
    totalAmount: 2000, paymentMethod: 'BANK_TRANSFER', bankReference: 'DEP-1',
  } as never);
  await svc.supplierPaymentService.approve(other(), p.id);
  await svc.supplierPaymentService.post(env.identity, { paymentId: p.id });
  paymentId = p.id;
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('SR-01: posts at once — Dr bank / Cr Supplier advance — and the payment holds less unapplied', async () => {
  const r = await refunds.record(env.identity, { paymentId, bankAccountId: env.bankAccountId, amount: '1500.00', refundDate: day(), reason: 'Order cancelled', reference: 'TT-BACK-1' });
  expect(r).toMatchObject({ status: 'POSTED', amount: '1500.00' });
  expect(r.refundNumber).toMatch(/^SR-/);
  const row = await prisma.supplierRefund.findUniqueOrThrow({ where: { id: r.id } });
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: row.postedJournalEntryId! } });
  const payJournal = (await prisma.supplierPayment.findUniqueOrThrow({ where: { id: paymentId } })).postedJournalEntryId!;
  const advance = (await prisma.journalLine.findMany({ where: { journalEntryId: payJournal } })).find((l) => l.debitAmount.gt(0))!;
  expect(lines.find((l) => l.accountId === env.accounts.bankId)?.debitAmount.toFixed(2)).toBe('1500.00');
  expect(lines.find((l) => l.accountId === advance.accountId)?.creditAmount.toFixed(2)).toBe('1500.00');
  expect(await unapplied()).toBe('500.00');

  const s = await new SupplierStatementService({ getClient: () => prisma } as never, new SupplierStatementRepository()).statement(env.identity, env.supplierId, day(), day());
  expect(s.lines.map((l) => [l.kind, l.debit, l.credit, l.balance])).toEqual([
    ['PAYMENT', '2000.00', null, '-2000.00'],
    ['REFUND', null, '1500.00', '-500.00'],
  ]);
  expect(s.unapplied).toBe('500.00');
  expect(Number(s.closingBalance)).toBe(-Number(s.unapplied));
});

it('SR-02: capped at what the payment holds unapplied; a reason is required', async () => {
  await expect(refunds.record(env.identity, { paymentId, bankAccountId: env.bankAccountId, amount: '500.01', refundDate: day(), reason: 'Rest' })).rejects.toMatchObject({ status: 400 });
  await expect(refunds.record(env.identity, { paymentId, bankAccountId: env.bankAccountId, amount: '10.00', refundDate: day(), reason: ' ' })).rejects.toMatchObject({ status: 400 });
  expect(await unapplied()).toBe('500.00');
});

it('SR-03: the payment cannot be reversed under a refund; reversing the refund puts the money back', async () => {
  await expect(svc.supplierPaymentService.reverse(env.identity, paymentId, { reversalDate: day(), reason: 'Wrong' })).rejects.toMatchObject({ status: 400 });
  const [r] = await refunds.listForPayment(env.identity, paymentId);
  const back = await refunds.reverse(env.identity, r!.id, { reversalDate: day(), reason: 'Transfer bounced' });
  expect(back.status).toBe('REVERSED');
  await expect(refunds.reverse(env.identity, r!.id, { reversalDate: day(), reason: 'again' })).rejects.toMatchObject({ status: 409 });
  expect(await unapplied()).toBe('2000.00');
  await svc.supplierPaymentService.reverse(env.identity, paymentId, { reversalDate: day(), reason: 'Wrong' });
});
