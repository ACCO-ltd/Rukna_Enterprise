/**
 * OBPAY — paying supplier bills carried over as opening balances (postingStatus OPENING_BALANCE).
 *
 * The opening-balance wizard (EVT-OPB-001) credits AP control with the carried-over payables and
 * imports each open bill with `outstandingAmount = totalAmount`. Those bills are real AP: a
 * payment settles them exactly as it settles a POSTED bill (Dr AP control / Cr Bank, EVT-AP-003).
 *
 *   OBPAY-01  The wizard leaves AP control (GL) = Σ outstanding of the imported bills
 *   OBPAY-02  Eligibility: canPay, POSTED step DONE "Opening balance — carried from the previous system"
 *   OBPAY-03  Part payment: create → approve → post; journal balanced, Dr AP control / Cr Bank on the
 *             payment's accountingDate; outstanding reduced; PARTIALLY_PAID; AP GL = Σ outstanding
 *   OBPAY-04  Paying the rest settles it (PAID, FULLY_PAID); over-allocation still refused
 *   OBPAY-05  Reversing a payment restores the opening-balance bill's outstanding; AP GL = Σ outstanding
 *   OBPAY-06  A posted advance can be applied to an opening-balance bill (EVT-AP-005: Dr AP / Cr Advance)
 *   OBPAY-07  Posting an opening-balance bill is still refused (409 OPENING_BALANCE_BILL)
 *   OBPAY-08  No commitment-ledger entries are written by any of it (opening-balance bills have no PO)
 *   OBPAY-09  The wizard's own reconciliation sees its opening journal (GL read on the same tx)
 *   OBPAY-10  Posting a payment for an opening-balance bill against a DIFFERENT AP account → 409
 *             OPENING_BALANCE_AP_NOT_RECONCILED (the payables are not on the account it would debit)
 *
 * The fixture chart has two ACCOUNTS_PAYABLE-subtype accounts (AP-TEST and the SYSTEM_ONLY CTL-TEST);
 * CTL-TEST is deactivated here so AP control resolves to one account, as on a real chart.
 */

import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';
import { SupplierBillDocumentService } from '../accounts-payable/application/supplier-bill-document.service';
import { billPaymentState, summarizeBillPayments } from '../accounts-payable/domain/supplier-bill-eligibility.policy';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let docs: SupplierBillDocumentService;
let billA: string; // 6,000 — paid in two parts, then one payment reversed
let billB: string; // 2,000 — settled by an advance
let commitmentRowsBefore = 0;
let wizardReport: Awaited<ReturnType<AccountingServices['openingBalanceService']['runWizard']>>;

const day = () => env.periods.openStart.toISOString().slice(0, 10);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  docs = new SupplierBillDocumentService(
    { getClient: () => prisma } as never,
    svc.supplierBillRepo,
    {} as never,
    {} as never,
    { requiresDualControl: async () => false } as never,
  );
  commitmentRowsBefore = await prisma.commitmentLedgerEntry.count({ where: { organizationId: env.orgId } });
  await prisma.account.update({ where: { id: env.accounts.ctrlId }, data: { status: 'INACTIVE' } });

  wizardReport = await svc.openingBalanceService.runWizard(env.identity, {
    cutoverDate: day(),
    batchReference: `OBPAY-${Date.now()}`,
    arAccountCode: env.accounts.arCode,
    apAccountCode: env.accounts.apCode,
    trialBalance: [
      { accountCode: env.accounts.bankCode, debitBalance: 20000 },
      { accountCode: env.accounts.apCode, creditBalance: 8000 },
      { accountCode: env.accounts.reCode, creditBalance: 12000 },
    ],
    openApBills: [
      {
        supplierId: env.supplierId, supplierInvoiceNumber: 'QB-OB-A', billDate: day(), dueDate: day(),
        currencyCode: 'USD', subtotal: 6000, vatAmount: 0, totalAmount: 6000, expenseProfileCode: env.postingProfileCode,
      },
      {
        supplierId: env.supplierId, supplierInvoiceNumber: 'QB-OB-B', billDate: day(), dueDate: day(),
        currencyCode: 'USD', subtotal: 2000, vatAmount: 0, totalAmount: 2000, expenseProfileCode: env.postingProfileCode,
      },
    ],
  });
  const bills = await prisma.supplierBill.findMany({ where: { organizationId: env.orgId, postingStatus: 'OPENING_BALANCE' } });
  billA = bills.find((b) => b.supplierInvoiceNumber === 'QB-OB-A')!.id;
  billB = bills.find((b) => b.supplierInvoiceNumber === 'QB-OB-B')!.id;
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

/** AP control's GL balance as a positive credit balance (what the trial balance shows). */
async function apGlCredit(): Promise<Decimal> {
  const r = await prisma.journalLine.aggregate({
    where: { accountId: env.accounts.apId, entry: { organizationId: env.orgId, status: 'POSTED' } },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return new Decimal(r._sum.creditAmount?.toString() ?? '0').minus(new Decimal(r._sum.debitAmount?.toString() ?? '0'));
}

/** The AP subledger: Σ outstanding over bills in the ledger. */
async function apSubledger(): Promise<Decimal> {
  const r = await prisma.supplierBill.aggregate({
    where: { organizationId: env.orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
    _sum: { outstandingAmount: true },
  });
  return new Decimal(r._sum.outstandingAmount?.toString() ?? '0');
}

/**
 * The AP subledger counting only POSTED payment allocations (the GL is debited only when a payment
 * posts; a draft payment already holds the bill's outstanding).
 */
async function expectApTiesOut() {
  const pendingHeld = await prisma.supplierPaymentAllocation.aggregate({
    where: { organizationId: env.orgId, postingStatus: 'NOT_POSTED' },
    _sum: { allocatedAmount: true },
  });
  const held = new Decimal(pendingHeld._sum.allocatedAmount?.toString() ?? '0');
  expect((await apGlCredit()).toFixed(2)).toBe((await apSubledger()).plus(held).toFixed(2));
}

async function payAndPost(billId: string, amount: number) {
  const payment = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId,
    bankAccountId: env.bankAccountId,
    paymentDate: day(),
    currencyCode: 'USD',
    totalAmount: amount,
    paymentMethod: 'BANK_TRANSFER',
    allocations: [{ supplierBillId: billId, amount }],
  });
  await svc.supplierPaymentService.approve(env.identity, payment.id);
  const posted = await svc.supplierPaymentService.post(env.identity, {
    paymentId: payment.id,
    apAccountCode: env.accounts.apCode,
    bankGlCode: env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });
  return { paymentId: payment.id, journalEntryId: posted.journalEntryId };
}

async function paymentState(billId: string) {
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billId } });
  const allocations = await prisma.supplierPaymentAllocation.findMany({
    where: { supplierBillId: billId },
    include: { payment: { select: { paymentDate: true } } },
  });
  const summary = summarizeBillPayments(
    allocations.map((a) => ({
      allocatedAmount: a.allocatedAmount.toString(),
      postingStatus: a.postingStatus,
      paymentId: a.supplierPaymentId,
      paymentDate: a.payment.paymentDate,
    })),
  );
  return billPaymentState(bill, summary);
}

test('OBPAY-01 the opening-balance journal puts the imported payables on AP control', async () => {
  expect((await apGlCredit()).toFixed(2)).toBe('8000.00');
  expect((await apSubledger()).toFixed(2)).toBe('8000.00');
});

test('OBPAY-02 eligibility reads an opening-balance bill as payable, truthfully', async () => {
  const e = await docs.eligibility(env.identity, billA);
  expect(e.canPay).toBe(true);
  expect(e.canPost).toBe(false);
  expect(e.blockedReason).toBeNull();
  expect(e.steps.find((s) => s.key === 'POSTED')).toMatchObject({
    status: 'DONE',
    detail: 'Opening balance — carried from the previous system, already in the ledger',
  });
  expect(e.steps.find((s) => s.key === 'PAID')).toMatchObject({ status: 'PENDING', code: 'NO_PAYMENT_RECORDED' });
});

test('OBPAY-03 part payment: Dr AP control / Cr Bank, balanced, outstanding reduced', async () => {
  const { journalEntryId } = await payAndPost(billA, 2500);

  const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: journalEntryId }, include: { lines: true } });
  expect(je.status).toBe('POSTED');
  expect(je.accountingDate.toISOString().slice(0, 10)).toBe(day());
  const dr = je.lines.reduce((s, l) => s.plus(l.debitAmount.toString()), new Decimal(0));
  const cr = je.lines.reduce((s, l) => s.plus(l.creditAmount.toString()), new Decimal(0));
  expect(dr.toFixed(2)).toBe(cr.toFixed(2));
  expect(je.lines).toHaveLength(2);
  const ap = je.lines.find((l) => l.accountId === env.accounts.apId)!;
  const bank = je.lines.find((l) => l.accountId === env.accounts.bankId)!;
  expect(ap.debitAmount.toString()).toBe('2500');
  expect(ap.supplierId).toBe(env.supplierId);
  expect(bank.creditAmount.toString()).toBe('2500');

  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billA } });
  expect(bill.outstandingAmount.toString()).toBe('3500');
  expect(bill.postingStatus).toBe('OPENING_BALANCE'); // never re-labelled POSTED
  expect(await paymentState(billA)).toBe('PARTIALLY_PAID');
  expect((await docs.eligibility(env.identity, billA)).steps.find((s) => s.key === 'PAID')?.code).toBe('PARTLY_PAID');
  await expectApTiesOut();
});

let secondPaymentId: string;

test('OBPAY-04 paying the rest settles the bill; over-allocation is still refused', async () => {
  await expect(
    svc.supplierPaymentService.create(env.identity, {
      supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD',
      totalAmount: 3500.01, paymentMethod: 'BANK_TRANSFER', allocations: [{ supplierBillId: billA, amount: 3500.01 }],
    }),
  ).rejects.toThrow(/exceeds bill outstanding/);

  secondPaymentId = (await payAndPost(billA, 3500)).paymentId;
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billA } });
  expect(bill.outstandingAmount.toString()).toBe('0');
  expect(await paymentState(billA)).toBe('PAID');
  const e = await docs.eligibility(env.identity, billA);
  expect(e.canPay).toBe(false);
  expect(e.blockedReason).toBe('FULLY_PAID');
  await expectApTiesOut();
});

test('OBPAY-05 reversing a payment restores the opening-balance bill outstanding', async () => {
  await svc.supplierPaymentService.reverse(env.identity, secondPaymentId, { reversalDate: day(), reason: 'test' });
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billA } });
  expect(bill.outstandingAmount.toString()).toBe('3500');
  expect(await paymentState(billA)).toBe('PARTIALLY_PAID');
  expect((await docs.eligibility(env.identity, billA)).canPay).toBe(true);
  await expectApTiesOut();
});

test('OBPAY-06 a posted advance can be applied to an opening-balance bill', async () => {
  const advance = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD',
    totalAmount: 1500, paymentMethod: 'BANK_TRANSFER',
  });
  await svc.supplierPaymentService.approve(env.identity, advance.id);
  await svc.supplierPaymentService.post(env.identity, {
    paymentId: advance.id, apAccountCode: env.accounts.apCode, bankGlCode: env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });
  const applied = await svc.supplierPaymentService.allocateAdvance(env.identity, {
    paymentId: advance.id, supplierBillId: billB, amount: 1500,
    apAccountCode: env.accounts.apCode, supplierAdvanceCode: env.accounts.advOutCode,
  });
  const je = await prisma.journalEntry.findUniqueOrThrow({ where: { id: applied.journalEntryId }, include: { lines: true } });
  expect(je.accountingDate.toISOString().slice(0, 10)).toBe(day()); // the payment's date, not today
  expect(je.lines.find((l) => l.accountId === env.accounts.apId)?.debitAmount.toString()).toBe('1500');
  expect(je.lines.find((l) => l.accountId === env.accounts.advOutId)?.creditAmount.toString()).toBe('1500');
  const bill = await prisma.supplierBill.findUniqueOrThrow({ where: { id: billB } });
  expect(bill.outstandingAmount.toString()).toBe('500');
  await expectApTiesOut();
  expect((await apGlCredit()).toFixed(2)).toBe('4000.00'); // 3,500 (A) + 500 (B)
});

test('OBPAY-07 posting an opening-balance bill is still refused (409)', async () => {
  await expect(
    svc.supplierBillService.post(env.identity, { billId: billA, apAccountCode: env.accounts.apCode }),
  ).rejects.toBeInstanceOf(ConflictException);
});

test('OBPAY-08 paying opening-balance bills writes no commitment-ledger entries', async () => {
  expect(await prisma.commitmentLedgerEntry.count({ where: { organizationId: env.orgId } })).toBe(commitmentRowsBefore);
});

test('OBPAY-09 the import reconciliation reads the GL inside its own transaction (zero variance)', () => {
  const ap = wizardReport.reconciliation.find((r) => r.label.startsWith('Accounts Payable'));
  expect(ap).toMatchObject({ glBalance: '8000.00', subledgerBalance: '8000.00', variance: '0.00', reconciled: true });
  expect(wizardReport.zeroVariance).toBe(true);
});

test('OBPAY-10 posting against an AP account that does not carry the opening payables is refused (409)', async () => {
  const payment = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId, bankAccountId: env.bankAccountId, paymentDate: day(), currencyCode: 'USD',
    totalAmount: 100, paymentMethod: 'BANK_TRANSFER', allocations: [{ supplierBillId: billB, amount: 100 }],
  });
  await svc.supplierPaymentService.approve(env.identity, payment.id);
  const run = svc.supplierPaymentService.post(env.identity, {
    paymentId: payment.id,
    apAccountCode: env.accounts.ctrlCode, // not the account the opening journal credited
    bankGlCode: env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });
  await expect(run).rejects.toBeInstanceOf(ConflictException);
  await expect(run).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_AP_NOT_RECONCILED' } });
  const after = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } });
  expect(after.postingStatus).not.toBe('POSTED');
  expect(await prisma.journalEntry.count({ where: { sourceDocumentId: payment.id, sourceDocumentType: 'SUPPLIER_PAYMENT' } })).toBe(0);
});
