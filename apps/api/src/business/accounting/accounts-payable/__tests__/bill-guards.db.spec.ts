/**
 * SB-1 — a supplier bill is refused at save when it could never post, or would post a wrong
 * figure; a reversal cannot predate its bill (live DB).
 *
 *   SB-01  only USD; the due date is not before the bill date; the total is more than 0
 *   SB-02  an unknown supplier is a 404, not a 500; an inactive one takes no new bill
 *   SB-03  an unknown expense profile is refused at save, not at posting
 *   SB-04  a reversal needs a reason and is dated on or after the bill
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const bill = (over: Record<string, unknown> = {}, line: Record<string, unknown> = {}) =>
  svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId,
    supplierInvoiceNumber: `SB-${Math.random().toString(36).slice(2, 9)}`,
    billDate: day(),
    dueDate: day(),
    currencyCode: 'USD',
    lines: [{ description: 'Scaffold hire', netAmount: 300, vatAmount: 0, expenseProfileCode: env.postingProfileCode, ...line }],
    ...over,
  } as never);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('SB-01: only USD; due date not before bill date; total more than 0', async () => {
  await expect(bill({ currencyCode: 'EUR' })).rejects.toMatchObject({ status: 400, response: { errorCode: 'CURRENCY_NOT_SUPPORTED' } });
  const before = new Date(env.periods.openStart.getTime() - 86_400_000).toISOString().slice(0, 10);
  await expect(bill({ dueDate: before })).rejects.toMatchObject({ response: { errorCode: 'DUE_BEFORE_BILL_DATE' } });
  await expect(bill({}, { netAmount: 0, vatAmount: 0 })).rejects.toMatchObject({ response: { errorCode: 'BILL_TOTAL_NOT_POSITIVE' } });
});

it('SB-02: unknown supplier is a 404; an inactive supplier takes no new bill', async () => {
  await expect(bill({ supplierId: 'no-such-supplier' })).rejects.toMatchObject({ status: 404, response: { errorCode: 'SUPPLIER_NOT_FOUND' } });
  const draft = await bill();
  await prisma.supplier.update({ where: { id: env.supplierId }, data: { status: 'INACTIVE' } });
  try {
    await expect(bill()).rejects.toMatchObject({ response: { errorCode: 'SUPPLIER_INACTIVE' } });
    // Their existing draft can still be corrected.
    const edited = await svc.supplierBillService.update(env.identity, draft.id, {
      supplierId: env.supplierId, supplierInvoiceNumber: draft.supplierInvoiceNumber, billDate: day(), dueDate: day(), currencyCode: 'USD',
      lines: [{ description: 'Scaffold hire', netAmount: 250, vatAmount: 0, expenseProfileCode: env.postingProfileCode }],
    } as never);
    expect(edited.totalAmount.toString()).toBe('250');
  } finally {
    await prisma.supplier.update({ where: { id: env.supplierId }, data: { status: 'ACTIVE' } });
  }
});

it('SB-03: an unknown expense profile is refused at save', async () => {
  await expect(bill({}, { expenseProfileCode: 'NO_SUCH_PROFILE' })).rejects.toMatchObject({ response: { errorCode: 'POSTING_PROFILE_NOT_FOUND' } });
});

it('SB-04: a reversal needs a reason and cannot predate the bill', async () => {
  const draft = await bill();
  await svc.supplierBillService.submit(env.identity, draft.id);
  const current = await prisma.supplierBill.findUniqueOrThrow({ where: { id: draft.id } });
  if (current.documentStatus === 'SUBMITTED') await svc.supplierBillService.approve(env.identity, draft.id);
  if (current.postingStatus !== 'POSTED') await svc.supplierBillService.post(env.identity, { billId: draft.id, apAccountCode: env.accounts.apCode });
  const before = new Date(env.periods.openStart.getTime() - 86_400_000).toISOString().slice(0, 10);
  await expect(svc.supplierBillService.reverse(env.identity, draft.id, { reversalDate: before, reason: 'Duplicate' }))
    .rejects.toMatchObject({ response: { errorCode: 'REVERSAL_BEFORE_BILL' } });
  await expect(svc.supplierBillService.reverse(env.identity, draft.id, { reversalDate: day(), reason: '   ' }))
    .rejects.toMatchObject({ status: 400 });
  await svc.supplierBillService.reverse(env.identity, draft.id, { reversalDate: day(), reason: 'Duplicate' });
  const reversed = await prisma.supplierBill.findUniqueOrThrow({ where: { id: draft.id } });
  expect(reversed.postingStatus).toBe('REVERSED');
});
