/**
 * ADR-046 §3/§4/§8 — Save posts, where the organisation's settings allow it (live DB).
 *
 *   AOS-01  a non-PO bill posts on Submit by default; at or above the approval amount it waits
 *   AOS-02  a payment within the auto-approval limit is approved and posted on save; above it, a draft
 *   AOS-03  a payment settling a bill the saver approved stays a draft (bill approver ≠ payment approver)
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, type AccountingServices } from './helpers/build-services';
import { activateSodRules, cleanupGovernance } from '../../procurement/__tests__/helpers/governance-fixture';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

const day = () => env.periods.openStart.toISOString().slice(0, 10);
const settings = (patch: Partial<{ billApprovalAbove: string | null; paymentAutoApproveUpTo: string }> = {}) =>
  svc.accountingConfig.updateApprovalSettings(env.identity, {
    invoiceApprovalAbove: null,
    billApprovalAbove: null,
    autoPostToleratedBills: false,
    paymentAutoApproveUpTo: '1000.00',
    ...patch,
  });

async function savedBill(amount: number) {
  const bill = await svc.supplierBillService.create(env.identity, {
    supplierId: env.supplierId,
    supplierInvoiceNumber: `AOS-${Math.random().toString(36).slice(2)}`,
    billDate: day(),
    dueDate: env.periods.openEnd.toISOString().slice(0, 10),
    currencyCode: 'USD',
    lines: [{ description: 'Site security', netAmount: amount, vatAmount: 0, expenseProfileCode: env.postingProfileCode }],
  } as never);
  return svc.supplierBillService.submit(env.identity, bill.id);
}

const pay = (amount: number, allocations: Array<{ supplierBillId: string; amount: number }> = []) =>
  svc.supplierPaymentService.record(env.identity, {
    supplierId: env.supplierId,
    bankAccountId: env.bankAccountId,
    paymentDate: day(),
    currencyCode: 'USD',
    totalAmount: amount,
    paymentMethod: 'BANK_TRANSFER',
    allocations,
  } as never);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma, { approvalSettings: true });
  // The fixture's second AP-subtype account (a control-account test double) would make AP role
  // resolution ambiguous; a real chart has one. Retire it for this suite.
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });
  await activateSodRules(prisma, env.orgId, ['BILL_APPROVER_CANNOT_APPROVE_OR_RELEASE_PAYMENT']);
}, 60_000);

afterAll(async () => {
  await cleanupGovernance(prisma, env.orgId);
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('AOS-01: a non-PO bill posts on Submit; at or above the approval amount it waits', async () => {
  await settings({ billApprovalAbove: '5000.00' });
  const small = await savedBill(1200);
  expect(small).toMatchObject({ postedOnSave: true, documentStatus: 'APPROVED', postingStatus: 'POSTED' });

  const large = await savedBill(5000);
  expect(large.documentStatus).toBe('SUBMITTED');
  expect((large as { postedOnSave?: boolean }).postedOnSave).toBeUndefined();
});

it('AOS-02: a payment within the limit is approved and posted on save; above it, a draft', async () => {
  await settings({ paymentAutoApproveUpTo: '1000.00' });
  const within = await pay(1000);
  expect(within).toMatchObject({ approvedOnSave: true, postedOnSave: true, documentStatus: 'APPROVED', postingStatus: 'POSTED' });

  const above = await pay(1000.01);
  expect(above.documentStatus).toBe('DRAFT');

  await settings({ paymentAutoApproveUpTo: '0' });
  expect((await pay(10)).documentStatus).toBe('DRAFT');
});

it('AOS-03: a payment settling a bill the saver approved stays a draft for someone else', async () => {
  await settings({ paymentAutoApproveUpTo: '1000.00' });
  // AOS-01's small bill was approved (and posted) by this user on save.
  const bill = await prisma.supplierBill.findFirstOrThrow({ where: { organizationId: env.orgId, postingStatus: 'POSTED' } });
  const payment = await pay(300, [{ supplierBillId: bill.id, amount: 300 }]);
  expect(payment).toMatchObject({ approvedOnSave: false, documentStatus: 'DRAFT' });
});
