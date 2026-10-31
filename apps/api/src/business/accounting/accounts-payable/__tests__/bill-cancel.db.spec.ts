/**
 * AP-2 — dropping a draft bill that will never be submitted (live DB).
 *
 *   BC-01  a draft is cancelled with a reason, stays on record, and frees its supplier invoice number
 *   BC-02  a reason is required; a submitted bill cannot be cancelled (it is returned or rejected)
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
const day = () => env.periods.openStart.toISOString().slice(0, 10);
const draft = (invoiceNumber: string) =>
  svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId, supplierInvoiceNumber: invoiceNumber, billDate: day(), dueDate: day(), currencyCode: 'USD',
    lines: [{ description: 'Scaffold hire', netAmount: 300, expenseProfileCode: env.postingProfileCode }],
  } as never);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('BC-01: a draft is cancelled with a reason and frees its supplier invoice number', async () => {
  const bill = await draft('INV-77');
  await expect(draft('INV-77')).rejects.toMatchObject({ status: 409 });
  const cancelled = await svc.supplierBillService.cancel(env.identity, bill.id, 'Entered twice');
  expect(cancelled).toMatchObject({ documentStatus: 'CANCELLED', cancellationReason: 'Entered twice', cancelledBy: env.identity.userId });
  const again = await draft('INV-77');
  expect(again.documentStatus).toBe('DRAFT');
});

it('BC-02: a reason is required; a submitted bill cannot be cancelled', async () => {
  const bill = await draft('INV-78');
  await expect(svc.supplierBillService.cancel(env.identity, bill.id, ' ')).rejects.toMatchObject({ status: 400 });
  await svc.supplierBillService.submit(env.identity, bill.id);
  await expect(svc.supplierBillService.cancel(env.identity, bill.id, 'Too late')).rejects.toMatchObject({ status: 404 });
});
