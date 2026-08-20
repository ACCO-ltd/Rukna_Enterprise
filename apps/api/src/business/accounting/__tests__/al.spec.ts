/**
 * AL — Allocation lifecycle
 *
 *   AL-01  Full receipt → invoice allocation sets invoice outstandingAmount to zero
 *   AL-02  Partial allocation reduces invoice outstandingAmount proportionally
 *   AL-03  Over-allocation is rejected (allocation total exceeds receipt amount)
 *   AL-04  Subsequent allocation of an unallocated receipt amount succeeds
 *   AL-05  Reversed receipt cannot be subsequently allocated
 *   AL-06  Posting an already-POSTED invoice is rejected (ConflictException)
 *   AL-07  AP: advance payment posted then fully allocated to bill → bill outstanding = 0
 *   AL-08  AP: advance payment (unallocated) posts to the supplier advance GL account
 *   AL-09  AP: subsequent advance allocation (advance → bill) reduces bill outstanding
 *   AL-10  Cannot reverse a bill that has active payment allocations
 *   AL-11  Cannot reverse a receipt that has subsequent (post-payment) allocations
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// ── AR helpers ────────────────────────────────────────────────────────────────

async function createAndPostInvoice(amount: number) {
  const inv = await prisma.clientInvoice.create({
    data: {
      organizationId:          env.orgId,
      clientId:                env.clientId,
      sourceIpcId:             null,
      invoiceDate:             env.periods.openStart,
      dueDate:                 env.periods.openEnd,
      currencyCode:            'USD',
      subtotal:                new Decimal(amount),
      vatAmount:               new Decimal(0),
      totalAmount:             new Decimal(amount),
      outstandingAmount:       new Decimal(amount),
      billingAddressSnapshot:  {},
      documentStatus:          'APPROVED',
      postingStatus:           'NOT_POSTED',
      createdBy:               env.identity.userId,
    },
  });

  await svc.clientInvoiceService.post(env.identity, {
    invoiceId:          inv.id,
    arAccountCode:      env.accounts.arCode,
    revenueAccountCode: env.accounts.revCode,
  });

  return prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
}

async function createApprovedReceipt(amount: number) {
  return prisma.paymentReceipt.create({
    data: {
      organizationId:    env.orgId,
      clientId:          env.clientId,
      bankAccountId:     env.bankAccountId,
      receiptDate:       env.periods.openStart,
      accountingDate:    env.periods.openStart,
      totalAmount:       new Decimal(amount),
      allocatedAmount:   new Decimal(0),
      unallocatedAmount: new Decimal(amount),
      currencyCode:      'USD',
      documentStatus:    'APPROVED',
      postingStatus:     'NOT_POSTED',
      createdBy:         env.identity.userId,
    },
  });
}

// ── AP helpers ────────────────────────────────────────────────────────────────

async function createAndPostBill(amount: number, uniqSuffix = '') {
  const bill = await prisma.supplierBill.create({
    data: {
      organizationId:            env.orgId,
      supplierId:                env.supplierId,
      supplierInvoiceNumber:     `SUPP-AL-${Date.now()}${uniqSuffix}`,
      supplierInvoiceNumberNorm: `SUPPAL${Date.now()}${uniqSuffix}`,
      billDate:                  env.periods.openStart,
      dueDate:                   env.periods.openEnd,
      currencyCode:              'USD',
      subtotal:                  new Decimal(amount),
      vatAmount:                 new Decimal(0),
      totalAmount:               new Decimal(amount),
      outstandingAmount:         new Decimal(amount),
      documentStatus:            'APPROVED',
      postingStatus:             'NOT_POSTED',
      createdBy:                 env.identity.userId,
      lines: {
        create: [{
          lineNumber:         1,
          description:        'Test expense line',
          netAmount:          new Decimal(amount),
          vatAmount:          new Decimal(0),
          grossAmount:        new Decimal(amount),
          expenseProfileCode: env.postingProfileCode,
        }],
      },
    },
  });

  await svc.supplierBillService.post(env.identity, {
    billId:        bill.id,
    apAccountCode: env.accounts.apCode,
  });

  return prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
}

/** Creates an APPROVED supplier payment where the entire amount is unallocated (full advance). */
async function createApprovedAdvancePayment(amount: number) {
  return prisma.supplierPayment.create({
    data: {
      organizationId:       env.orgId,
      supplierId:           env.supplierId,
      bankAccountId:        env.bankAccountId,
      paymentDate:          env.periods.openStart,
      accountingDate:       env.periods.openStart,
      currencyCode:         'USD',
      totalAmount:          new Decimal(amount),
      allocatedAmount:      new Decimal(0),
      unallocatedAmount:    new Decimal(amount),
      paymentMethod:        'BANK_TRANSFER',
      documentStatus:       'APPROVED',
      postingStatus:        'NOT_POSTED',
      createdBy:            env.identity.userId,
    },
  });
}

// ─── AL-01 ────────────────────────────────────────────────────────────────────
it('AL-01: full receipt → invoice allocation sets invoice outstandingAmount to zero', async () => {
  const invoice = await createAndPostInvoice(5000);
  const receipt = await createApprovedReceipt(5000);

  await svc.customerReceiptService.post(env.identity, {
    receiptId:            receipt.id,
    bankAccountCode:      env.accounts.bankCode,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
    allocations:          [{ clientInvoiceId: invoice.id, amount: 5000 }],
  });

  const updated = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  expect(Number(updated.outstandingAmount)).toBe(0);
});

// ─── AL-02 ────────────────────────────────────────────────────────────────────
it('AL-02: partial allocation reduces invoice outstandingAmount proportionally', async () => {
  const invoice = await createAndPostInvoice(10000);
  const receipt = await createApprovedReceipt(10000);

  await svc.customerReceiptService.post(env.identity, {
    receiptId:            receipt.id,
    bankAccountCode:      env.accounts.bankCode,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
    allocations:          [{ clientInvoiceId: invoice.id, amount: 4000 }],
  });

  const updated = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  expect(Number(updated.outstandingAmount)).toBe(6000);
});

// ─── AL-03 ────────────────────────────────────────────────────────────────────
it('AL-03: over-allocation is rejected when allocation total exceeds receipt amount', async () => {
  const receipt = await createApprovedReceipt(3000);
  const invoice = await createAndPostInvoice(5000);

  await expect(
    svc.customerReceiptService.post(env.identity, {
      receiptId:            receipt.id,
      bankAccountCode:      env.accounts.bankCode,
      arAccountCode:        env.accounts.arCode,
      unappliedAccountCode: env.accounts.unaplCode,
      allocations:          [{ clientInvoiceId: invoice.id, amount: 4000 }], // > receipt 3000
    }),
  ).rejects.toThrow(/exceed|over-allocat/i);
});

// ─── AL-04 ────────────────────────────────────────────────────────────────────
it('AL-04: subsequent allocation of an unallocated receipt succeeds', async () => {
  const invoice = await createAndPostInvoice(8000);
  const receipt = await createApprovedReceipt(8000);

  // Post receipt with no initial allocations → entire amount goes to Unapplied
  await svc.customerReceiptService.post(env.identity, {
    receiptId:            receipt.id,
    bankAccountCode:      env.accounts.bankCode,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
    allocations:          [],
  });

  // Subsequent allocation via allocate()
  await svc.customerReceiptService.allocate(env.identity, {
    receiptId:            receipt.id,
    clientInvoiceId:      invoice.id,
    amount:               8000,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
  });

  const updated = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: invoice.id } });
  expect(Number(updated.outstandingAmount)).toBe(0);
});

// ─── AL-05 ────────────────────────────────────────────────────────────────────
it('AL-05: reversed receipt cannot be subsequently allocated', async () => {
  const invoice = await createAndPostInvoice(2000);
  const receipt = await createApprovedReceipt(2000);

  // Post with no initial allocations
  await svc.customerReceiptService.post(env.identity, {
    receiptId:            receipt.id,
    bankAccountCode:      env.accounts.bankCode,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
  });

  // Reverse the receipt — signature: (identity, receiptId, opts)
  await svc.customerReceiptService.reverse(env.identity, receipt.id, {
    reversalDate: '2025-01-25',
    reason:       'AL-05 test',
  });

  // Subsequent allocation must fail because receipt is REVERSED (postingStatus = REVERSED)
  await expect(
    svc.customerReceiptService.allocate(env.identity, {
      receiptId:            receipt.id,
      clientInvoiceId:      invoice.id,
      amount:               2000,
      arAccountCode:        env.accounts.arCode,
      unappliedAccountCode: env.accounts.unaplCode,
    }),
  ).rejects.toThrow(/posted|reversed|status/i);
});

// ─── AL-06 ────────────────────────────────────────────────────────────────────
it('AL-06: posting an already-POSTED invoice is rejected', async () => {
  const inv = await prisma.clientInvoice.create({
    data: {
      organizationId:         env.orgId,
      clientId:               env.clientId,
      sourceIpcId:            null,
      invoiceDate:            env.periods.openStart,
      dueDate:                env.periods.openEnd,
      currencyCode:           'USD',
      subtotal:               new Decimal('1200'),
      vatAmount:              new Decimal(0),
      totalAmount:            new Decimal('1200'),
      outstandingAmount:      new Decimal('1200'),
      billingAddressSnapshot: {},
      documentStatus:         'APPROVED',
      postingStatus:          'NOT_POSTED',
      createdBy:              env.identity.userId,
    },
  });

  const dto = {
    invoiceId:          inv.id,
    arAccountCode:      env.accounts.arCode,
    revenueAccountCode: env.accounts.revCode,
  };

  // First post succeeds
  await svc.clientInvoiceService.post(env.identity, dto);

  // Second post must be rejected — service guards postingStatus === 'POSTED'
  await expect(svc.clientInvoiceService.post(env.identity, dto)).rejects.toThrow(
    /already posted|conflict/i,
  );
});

// ─── AL-07 ────────────────────────────────────────────────────────────────────
it('AL-07: advance payment posted then fully allocated to bill → bill outstandingAmount = 0', async () => {
  const bill    = await createAndPostBill(6000, '-al07');
  const payment = await createApprovedAdvancePayment(6000);

  // Post payment as full advance: Dr Supplier Advance / Cr Bank
  await svc.supplierPaymentService.post(env.identity, {
    paymentId:           payment.id,
    apAccountCode:       env.accounts.apCode,
    bankGlCode:          env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  // Allocate the advance to the bill: Dr AP / Cr Supplier Advance → clears AP + reduces outstanding
  await svc.supplierPaymentService.allocateAdvance(env.identity, {
    paymentId:           payment.id,
    supplierBillId:      bill.id,
    amount:              6000,
    apAccountCode:       env.accounts.apCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  const updated = await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
  expect(Number(updated.outstandingAmount)).toBe(0);
});

// ─── AL-08 ────────────────────────────────────────────────────────────────────
it('AL-08: advance payment (unallocated) posts to the supplier advance GL account', async () => {
  const payment = await createApprovedAdvancePayment(4000);

  const balanceBefore = await svc.journalRepo.getGlBalance(
    prisma as never, env.orgId, env.accounts.advOutId,
  );

  await svc.supplierPaymentService.post(env.identity, {
    paymentId:           payment.id,
    apAccountCode:       env.accounts.apCode,
    bankGlCode:          env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  const balanceAfter = await svc.journalRepo.getGlBalance(
    prisma as never, env.orgId, env.accounts.advOutId,
  );

  // Advance account (DEBIT normal) increases by 4000 after the advance posting
  const increase = balanceAfter.minus(balanceBefore);
  expect(increase.gte(new Decimal('4000'))).toBe(true);
});

// ─── AL-09 ────────────────────────────────────────────────────────────────────
it('AL-09: subsequent advance allocation (advance → bill) reduces bill outstanding', async () => {
  const bill    = await createAndPostBill(3500, '-al09');
  const payment = await createApprovedAdvancePayment(3500);

  // Post payment as advance
  await svc.supplierPaymentService.post(env.identity, {
    paymentId:           payment.id,
    apAccountCode:       env.accounts.apCode,
    bankGlCode:          env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  // Now allocate the advance to the bill
  await svc.supplierPaymentService.allocateAdvance(env.identity, {
    paymentId:           payment.id,
    supplierBillId:      bill.id,
    amount:              3500,
    apAccountCode:       env.accounts.apCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  const updated = await prisma.supplierBill.findUniqueOrThrow({ where: { id: bill.id } });
  expect(Number(updated.outstandingAmount)).toBe(0);
});

// ─── AL-10 ────────────────────────────────────────────────────────────────────
it('AL-10: cannot reverse a bill that has an active payment allocation', async () => {
  const bill    = await createAndPostBill(2000, '-al10');
  const payment = await createApprovedAdvancePayment(2000);

  // Post advance payment
  await svc.supplierPaymentService.post(env.identity, {
    paymentId:           payment.id,
    apAccountCode:       env.accounts.apCode,
    bankGlCode:          env.accounts.bankCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  // Create active SupplierPaymentAllocation linking payment → bill
  await svc.supplierPaymentService.allocateAdvance(env.identity, {
    paymentId:           payment.id,
    supplierBillId:      bill.id,
    amount:              2000,
    apAccountCode:       env.accounts.apCode,
    supplierAdvanceCode: env.accounts.advOutCode,
  });

  // Bill reversal must be rejected — guard checks for POSTED supplierPaymentAllocations
  await expect(
    svc.supplierBillService.reverse(env.identity, bill.id, {
      reversalDate: '2025-01-25',
      reason:       'AL-10 test',
    }),
  ).rejects.toThrow(/allocation|payment.*allocated|Cannot reverse/i);
});

// ─── AL-11 ────────────────────────────────────────────────────────────────────
it('AL-11: cannot reverse a receipt that has subsequent (post-payment) allocations', async () => {
  const invoice = await createAndPostInvoice(7000);
  const receipt = await createApprovedReceipt(7000);

  // Post receipt fully to unapplied (no initial allocations)
  await svc.customerReceiptService.post(env.identity, {
    receiptId:            receipt.id,
    bankAccountCode:      env.accounts.bankCode,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
    allocations:          [],
  });

  // Subsequent allocation — creates a clientReceiptAllocation with a NEW journal entry id
  await svc.customerReceiptService.allocate(env.identity, {
    receiptId:            receipt.id,
    clientInvoiceId:      invoice.id,
    amount:               7000,
    arAccountCode:        env.accounts.arCode,
    unappliedAccountCode: env.accounts.unaplCode,
  });

  // Reversal must be rejected — subsequent allocation must be reversed first
  await expect(
    svc.customerReceiptService.reverse(env.identity, receipt.id, {
      reversalDate: '2025-01-26',
      reason:       'AL-11 test',
    }),
  ).rejects.toThrow(/subsequent|allocation.*must be reversed|has \d+ subsequent/i);
});
