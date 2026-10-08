import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

import { buildPaymentServices, type PaymentServices } from './helpers/build-payment-services.js';
import { cleanupPaymentEnv, createPaymentEnv, journalLines, type PaymentTestEnv } from './helpers/payment-fixture.js';

/**
 * ADR-045 P3 (live DB) — AP posting resolves its GL accounts server-side.
 *
 *  - GL-01: a bill posted without apAccountCode produces the same journal as with the right code.
 *  - GL-02: a payment posted without codes = with the right codes (bank GL from the bank account).
 *  - GL-03: a supplied bankGlCode that is not the payment's bank account GL → 409 BANK_GL_MISMATCH.
 *  - GL-04: two ACTIVE AP accounts → POSTING_ACCOUNT_AMBIGUOUS when no code is sent.
 */
describe('ADR-045 P3 — server-side GL resolution for AP posting', () => {
  const prisma = new PrismaClient();
  let env: PaymentTestEnv;
  let svc: PaymentServices;

  beforeAll(async () => {
    env = await createPaymentEnv(prisma);
    svc = buildPaymentServices(prisma);
  });

  afterAll(async () => {
    await cleanupPaymentEnv(prisma, env);
    await prisma.$disconnect();
  });

  /** A non-PO bill of `amount`, submitted and approved (by payer2), ready to post. */
  async function approvedBill(amount: number) {
    const bill = await svc.bills.create(env.identity, {
      supplierId: env.supplierId,
      supplierInvoiceNumber: `INV-${randomUUID().slice(0, 8)}`,
      billDate: '2026-10-05',
      dueDate: '2026-11-05',
      currencyCode: 'USD',
      projectId: env.projectId,
      lines: [
        {
          description: 'Site cleaning',
          netAmount: amount,
          vatAmount: 0,
          expenseProfileCode: env.postingProfileCode,
          projectId: env.projectId,
          spendCategoryId: env.spendCategoryId,
        },
      ],
    });
    await svc.bills.submit(env.identity, bill.id);
    await svc.bills.approve(env.payer2, bill.id);
    return bill;
  }

  /** An APPROVED payment from `bankAccountId` fully allocated to `billId`. */
  async function approvedPayment(billId: string, amount: number, bankAccountId = env.bank.cashBoxId) {
    const payment = await svc.payments.create(env.identity, {
      supplierId: env.supplierId,
      bankAccountId,
      paymentDate: '2026-10-06',
      currencyCode: 'USD',
      totalAmount: amount,
      paymentMethod: 'CASH',
      allocations: [{ supplierBillId: billId, amount }],
    });
    await svc.payments.approve(env.as('selector'), payment.id);
    return payment;
  }

  it('GL-01: bill post without apAccountCode = with the right code', async () => {
    const a = await approvedBill(120);
    const b = await approvedBill(120);
    const withCode = await svc.bills.post(env.identity, { billId: a.id, apAccountCode: env.accounts.apCode });
    const without = await svc.bills.post(env.identity, { billId: b.id });
    const ja = await journalLines(prisma, withCode.journalEntryId);
    const jb = await journalLines(prisma, without.journalEntryId);
    expect(jb.lines).toEqual(ja.lines);
    expect(jb.lines).toContainEqual(['AP-PROC', '0.00', '120.00']);
    expect(jb.entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-05');
  });

  it('GL-02: payment post without codes = with the right codes; credits the bank account GL', async () => {
    const billA = await approvedBill(75);
    const billB = await approvedBill(75);
    await svc.bills.post(env.identity, { billId: billA.id });
    await svc.bills.post(env.identity, { billId: billB.id });
    const pa = await approvedPayment(billA.id, 75);
    const pb = await approvedPayment(billB.id, 75);
    const withCodes = await svc.payments.post(env.identity, {
      paymentId: pa.id,
      apAccountCode: env.accounts.apCode,
      bankGlCode: '10900',
      supplierAdvanceCode: '13000',
    });
    const without = await svc.payments.post(env.identity, { paymentId: pb.id });
    const ja = await journalLines(prisma, withCodes.journalEntryId);
    const jb = await journalLines(prisma, without.journalEntryId);
    expect(jb.lines).toEqual(ja.lines);
    expect(jb.lines).toEqual([
      ['AP-PROC', '75.00', '0.00'],
      ['10900', '0.00', '75.00'],
    ]);
    expect(jb.entry.accountingDate.toISOString().slice(0, 10)).toBe('2026-10-06');
  });

  it('GL-02b: an unallocated payment (advance) resolves the supplier advance account by role', async () => {
    const payment = await svc.payments.create(env.identity, {
      supplierId: env.supplierId,
      bankAccountId: env.bank.evcId,
      paymentDate: '2026-10-06',
      currencyCode: 'USD',
      totalAmount: 40,
      paymentMethod: 'MOBILE_MONEY',
    });
    await svc.payments.approve(env.as('selector'), payment.id);
    const posted = await svc.payments.post(env.identity, { paymentId: payment.id });
    expect((await journalLines(prisma, posted.journalEntryId)).lines).toEqual([
      ['13000', '40.00', '0.00'],
      ['10950', '0.00', '40.00'],
    ]);
  });

  it('GL-03: a bankGlCode other than the payment bank account GL is refused (409 BANK_GL_MISMATCH)', async () => {
    const bill = await approvedBill(30);
    await svc.bills.post(env.identity, { billId: bill.id });
    const payment = await approvedPayment(bill.id, 30);
    await expect(
      svc.payments.post(env.identity, { paymentId: payment.id, bankGlCode: '10100' }),
    ).rejects.toMatchObject({ status: 409, response: { details: { code: 'BANK_GL_MISMATCH', bankGlCode: '10900' } } });
    const after = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(after.postingStatus).not.toBe('POSTED');
  });

  it('GL-04: two ACTIVE AP control accounts → POSTING_ACCOUNT_AMBIGUOUS without a code; a code still works', async () => {
    const bill = await approvedBill(10);
    const second = await prisma.account.create({
      data: { organizationId: env.orgId, code: 'AP-2', normalBalance: 'CREDIT', createdBy: env.identity.userId },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: second.id,
        versionNumber: 1,
        name: 'AP 2',
        accountClass: 'LIABILITY',
        accountSubtype: 'ACCOUNTS_PAYABLE',
        isPostingAllowed: true,
        effectiveFrom: new Date('2025-01-01'),
        changedBy: env.identity.userId,
      },
    });
    try {
      await expect(svc.bills.post(env.identity, { billId: bill.id })).rejects.toThrow('POSTING_ACCOUNT_AMBIGUOUS:ACCOUNTS_PAYABLE');
      await expect(svc.bills.post(env.identity, { billId: bill.id, apAccountCode: env.accounts.apCode })).resolves.toBeTruthy();
    } finally {
      await prisma.account.update({ where: { id: second.id }, data: { status: 'INACTIVE' } });
    }
  });
});
