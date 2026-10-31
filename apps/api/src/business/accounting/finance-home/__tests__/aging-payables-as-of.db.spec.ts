/**
 * Payables aging as of a past day, AA (2026-10-30) — live DB.
 *
 *   AA-01  a bill at what was still owed on it that day: before it existed, after a payment,
 *          after a debit note, while a payment stood and after it was reversed
 *   AA-02  money paid ahead of a bill shows as paid in advance, and the net is owed less that
 *   AA-03  the aging total agrees with the AP control account on every day
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { FinanceHomeRepository } from '../infrastructure/finance-home.repository';
import { AgingReportService } from '../application/aging-report.service';
import { CommitmentLedgerWriter } from '../../../procurement/commitment-ledger/application/commitment-ledger-writer.service';
import { CommitmentLedgerRepository } from '../../../procurement/commitment-ledger/infrastructure/commitment-ledger.repository';
import { SupplierDebitNoteService } from '../../accounts-payable/application/supplier-debit-note.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let aging: AgingReportService;
const other = () => ({ ...env.identity, userId: 'second-approver' });
const day = (n: number) => new Date(env.periods.openStart.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const report = (asOf?: string) => aging.report({ ...env.identity, permissions: [PERMISSIONS.payablesManage] }, 'payables', asOf);
const ours = async (asOf?: string) => (await report(asOf)).rows.find((r) => r.partyId === env.supplierId);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  aging = new AgingReportService({ getClient: () => prisma } as never, new FinanceHomeRepository());
  // Day 2: bill 1000, due day 12. Day 5: a 700 payment, 400 applied and 300 paid ahead. Day 6: a
  // 100 debit note. Day 7: a 50 payment applied; it is reversed on day 9.
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId, supplierInvoiceNumber: 'AA-1', billDate: day(2), dueDate: day(12), currencyCode: 'USD',
    lines: [{ description: 'Formwork', netAmount: 1000, expenseProfileCode: env.postingProfileCode }],
  } as never);
  await svc.supplierBillService.submit(env.identity, bill.id);
  const b = await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
  if (b.documentStatus === 'SUBMITTED') await svc.supplierBillService.approve(other(), bill.id);
  if (b.postingStatus !== 'POSTED') await svc.supplierBillService.post(env.identity, { billId: bill.id, apAccountCode: env.accounts.apCode });
  const pay = async (date: string, total: number, applied: number) => {
    const p = await svc.supplierPaymentService.create(env.identity, {
      supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: date, currencyCode: 'USD', totalAmount: total,
      paymentMethod: 'BANK_TRANSFER', allocations: [{ supplierBillId: bill.id, amount: applied }],
    } as never);
    await svc.supplierPaymentService.approve(other(), p.id);
    await svc.supplierPaymentService.post(env.identity, { paymentId: p.id, apAccountCode: env.accounts.apCode });
    return p.id;
  };
  await pay(day(5), 700, 400);
  const notes = new SupplierDebitNoteService({ getClient: () => prisma } as never, svc.sequenceRepo, svc.postingService as never, new CommitmentLedgerWriter(new CommitmentLedgerRepository()));
  await notes.record(env.identity, { billId: bill.id, amount: '100.00', accountingDate: day(6), reason: 'Two pallets returned' });
  const bounced = await pay(day(7), 50, 50);
  await svc.supplierPaymentService.reverse(env.identity, bounced, { reversalDate: day(9), reason: 'Transfer returned' });
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('AA-01: each bill at what was owed on it that day', async () => {
  expect(await ours(day(1))).toBeUndefined();
  expect((await ours(day(3)))?.total).toBe('1000.00');
  expect((await ours(day(5)))?.total).toBe('600.00');
  expect((await ours(day(6)))?.total).toBe('500.00');
  expect((await ours(day(8)))?.total).toBe('450.00'); // the 50 stood
  expect((await ours(day(10)))?.total).toBe('500.00'); // reversed: owed again
  expect((await ours())?.total).toBe('500.00');
  expect((await report(day(8))).historical).toBe(true);
});

it('AA-02: money paid ahead shows as paid in advance; the net is owed less that', async () => {
  expect(await ours(day(4))).toMatchObject({ onAccount: '0.00' });
  expect(await ours(day(6))).toMatchObject({ total: '500.00', onAccount: '300.00', netBalance: '200.00' });
  expect(await ours()).toMatchObject({ onAccount: '300.00', netBalance: '200.00' });
});

it('AA-03: the total agrees with the AP control account on every day', async () => {
  for (const asOf of [day(3), day(5), day(6), day(8), day(10), undefined]) {
    const r = await report(asOf);
    expect(r.ledger).toMatchObject({ agrees: true, difference: '0.00' });
  }
});
