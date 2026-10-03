/**
 * OBTIE — the opening-balance AP tie-out that gates paying OPENING_BALANCE supplier bills.
 *
 * A payment debits AP control. An opening-balance bill may be paid only when the import's
 * opening journal (EVT-OPB-001) credits AP control with exactly the ORIGINAL total of the imported
 * bills — otherwise the debit would drain AP control while the carried-over balance sits elsewhere.
 *
 *   OBTIE-01  Payables credited to ANOTHER account (not AP control): create, allocateAdvance and
 *             eligibility all refuse with OPENING_BALANCE_AP_NOT_RECONCILED (409), in plain words
 *   OBTIE-02  No opening-balance journal at all: refused with the same code
 *   (Matching → payable is OBPAY-02..06.)
 */

import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';
import { SupplierBillDocumentService } from '../accounts-payable/application/supplier-bill-document.service';

const prisma = new PrismaClient();
let svc: AccountingServices;
let docs: SupplierBillDocumentService;
const envs: AccountingTestEnv[] = [];

const day = (env: AccountingTestEnv) => env.periods.openStart.toISOString().slice(0, 10);

beforeAll(() => {
  svc = buildServices(prisma);
  docs = new SupplierBillDocumentService(
    { getClient: () => prisma } as never,
    svc.supplierBillRepo,
    {} as never,
    {} as never,
    { requiresDualControl: async () => false } as never,
  );
});

afterAll(async () => {
  for (const env of envs) await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

async function freshOrg(): Promise<AccountingTestEnv> {
  const env = await AccountingFixtureFactory.create(prisma);
  envs.push(env);
  // One AP control account, as on a real chart (the fixture also carries a SYSTEM_ONLY one).
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });
  return env;
}

async function expectRefused(env: AccountingTestEnv, billId: string, message: RegExp) {
  const e = await docs.eligibility(env.identity, billId);
  expect(e.canPay).toBe(false);
  expect(e.blockedReason).toBe('OPENING_BALANCE_AP_NOT_RECONCILED');
  expect(e.steps.find((s) => s.key === 'PAID')).toMatchObject({ status: 'BLOCKED', code: 'OPENING_BALANCE_AP_NOT_RECONCILED' });
  expect(e.steps.find((s) => s.key === 'PAID')?.detail).toMatch(message);

  const create = svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(env), currencyCode: 'USD',
    totalAmount: 100, paymentMethod: 'BANK_TRANSFER', allocations: [{ supplierBillId: billId, amount: 100 }],
  });
  await expect(create).rejects.toBeInstanceOf(ConflictException);
  await expect(create).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_AP_NOT_RECONCILED' } });
  await expect(create).rejects.toThrow(message);

  // A posted advance cannot be applied to it either (the check runs inside the allocation tx).
  const advance = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(env), currencyCode: 'USD',
    totalAmount: 100, paymentMethod: 'BANK_TRANSFER',
  });
  await svc.supplierPaymentService.approve(env.identity, advance.id);
  await svc.supplierPaymentService.post(env.identity, {
    paymentId: advance.id, apAccountCode: env.accounts.apCode, bankGlCode: env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });
  await expect(
    svc.supplierPaymentService.allocateAdvance(env.identity, {
      paymentId: advance.id, supplierBillId: billId, amount: 100,
      apAccountCode: env.accounts.apCode, supplierAdvanceCode: env.accounts.advOutCode,
    }),
  ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_AP_NOT_RECONCILED' } });

  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
  expect(bill.outstandingAmount.toString()).toBe(bill.totalAmount.toString()); // untouched
  expect(await prisma.supplierPaymentAllocation.count({ where: { supplierBillId: billId } })).toBe(0);
}

test('OBTIE-01 payables credited to another account than AP control → refused (409)', async () => {
  const env = await freshOrg();
  await svc.openingBalanceService.runWizard(env.identity, {
    cutoverDate: day(env),
    batchReference: `OBTIE-${Date.now()}`,
    arAccountCode: env.accounts.arCode,
    apAccountCode: env.accounts.apCode,
    trialBalance: [
      { accountCode: env.accounts.bankCode, debitBalance: 5000 },
      // The supplier payables went to retained earnings, not AP control.
      { accountCode: env.accounts.reCode, creditBalance: 5000 },
    ],
    openApBills: [
      {
        supplierId: env.supplierId, supplierInvoiceNumber: 'QB-TIE-1', billDate: day(env), dueDate: day(env),
        currencyCode: 'USD', subtotal: 2000, vatAmount: 0, totalAmount: 2000, expenseProfileCode: env.postingProfileCode,
      },
    ],
  });
  const bill = await prisma.supplierBill.findFirstOrThrow({ where: { organizationId: env.orgId, postingStatus: 'OPENING_BALANCE' } });
  await expectRefused(env, bill.id, /credits AP-TEST 0\.00, imported bills total 2000\.00\)\. Fix the opening balance before paying\./);
});

test('OBTIE-02 no opening-balance journal → refused (409)', async () => {
  const env = await freshOrg();
  const bill = await prisma.supplierBill.create({
    data: {
      organizationId: env.orgId, supplierId: env.supplierId,
      supplierInvoiceNumber: 'QB-NOJ-1', supplierInvoiceNumberNorm: 'QBNOJ1',
      billDate: env.periods.openStart, dueDate: env.periods.openEnd, currencyCode: 'USD',
      subtotal: new Decimal(700), vatAmount: new Decimal(0), totalAmount: new Decimal(700), outstandingAmount: new Decimal(700),
      documentStatus: 'APPROVED', postingStatus: 'OPENING_BALANCE', createdBy: env.identity.userId,
    },
  });
  await expectRefused(env, bill.id, /no opening-balance journal is posted, imported bills total 700\.00/);
});
