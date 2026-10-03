/**
 * ELIG — ADR-043 Phase 2 on a real database: the "why blocked" read model agrees with the commands,
 * and the project filters on receipts / supplier payments / journals follow their membership rules.
 *
 *   ELIG-01  A draft bill reads BILL_NOT_SUBMITTED and post refuses it ("must be APPROVED")
 *   ELIG-02  An approved bill dated in a CLOSED / LOCKED period reads PERIOD_* and post throws the ledger's message
 *   ELIG-03  An approved bill in an open period reads canPost, and post succeeds; then canPay
 *   ELIG-04  Whole balance on a draft payment → PAYMENT_AWAITING_APPROVAL, and a second allocation is refused
 *   ELIG-05  GET /payments?projectId — via allocations to the project's bills (header or line)
 *   ELIG-06  GET /customer-receipts?projectId — via allocations to the project's invoices
 *   ELIG-07  GET /journals?projectId — via a line coded to the project
 *   ELIG-08  An opening-balance bill is refused by post (409) and payment, and eligibility says so
 */
import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';
import { SupplierBillDocumentService } from '../accounts-payable/application/supplier-bill-document.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let docs: SupplierBillDocumentService;
let projectA: string;
let projectB: string;
let seq = 0;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  const tenancy = { getClient: () => prisma } as never;
  docs = new SupplierBillDocumentService(
    tenancy,
    svc.supplierBillRepo,
    {} as never,
    {} as never,
    { requiresDualControl: async () => false } as never,
  );
  projectA = (await prisma.project.findFirstOrThrow({ where: { organizationId: env.orgId } })).id;
  projectB = (
    await prisma.project.create({
      data: {
        organizationId: env.orgId,
        code: 'PRJ-002',
        name: 'Other Project',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: env.identity.userId,
      },
    })
  ).id;
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

async function bill(opts: { documentStatus?: string; billDate?: Date; amount?: number; projectId?: string; lineProjectId?: string }) {
  const amount = opts.amount ?? 100;
  seq += 1;
  return prisma.supplierBill.create({
    data: {
      organizationId: env.orgId,
      supplierId: env.supplierId,
      supplierInvoiceNumber: `ELIG-${seq}-${Date.now()}`,
      supplierInvoiceNumberNorm: `ELIG${seq}${Date.now()}`,
      billDate: opts.billDate ?? env.periods.openStart,
      dueDate: env.periods.openEnd,
      currencyCode: 'USD',
      subtotal: new Decimal(amount),
      vatAmount: new Decimal(0),
      totalAmount: new Decimal(amount),
      outstandingAmount: new Decimal(amount),
      documentStatus: (opts.documentStatus ?? 'APPROVED') as never,
      postingStatus: 'NOT_POSTED',
      projectId: opts.projectId ?? null,
      createdBy: env.identity.userId,
      lines: {
        create: [
          {
            lineNumber: 1,
            description: 'line',
            netAmount: new Decimal(amount),
            vatAmount: new Decimal(0),
            grossAmount: new Decimal(amount),
            expenseProfileCode: env.postingProfileCode,
            projectId: opts.lineProjectId ?? null,
          },
        ],
      },
    },
  });
}

const post = (billId: string) => svc.supplierBillService.post(env.identity, { billId, apAccountCode: env.accounts.apCode });

test('ELIG-01 draft bill: eligibility and the post command agree', async () => {
  const b = await bill({ documentStatus: 'DRAFT' });
  const e = await docs.eligibility(env.identity, b.id);
  expect(e.canPost).toBe(false);
  expect(e.blockedReason).toBe('BILL_NOT_SUBMITTED');
  await expect(post(b.id)).rejects.toThrow('Bill must be APPROVED before posting');
});

test.each([
  ['closed', 'PERIOD_CLOSED', /is CLOSED/],
  ['locked', 'PERIOD_LOCKED', /is LOCKED/],
] as const)('ELIG-02 bill dated in the %s period', async (which, code, message) => {
  const billDate = which === 'closed' ? env.periods.closedStart : env.periods.lockedStart;
  const b = await bill({ billDate });
  const e = await docs.eligibility(env.identity, b.id);
  expect(e.canPost).toBe(false);
  expect(e.blockedReason).toBe(code);
  expect(e.steps.find((s) => s.key === 'PERIOD_OPEN')).toMatchObject({ status: 'BLOCKED', code });
  await expect(post(b.id)).rejects.toThrow(message);
});

test('ELIG-03/04 open period: canPost → post succeeds → canPay → draft payment holds the balance', async () => {
  const b = await bill({ amount: 250, projectId: projectA });
  expect((await docs.eligibility(env.identity, b.id)).canPost).toBe(true);
  await post(b.id);

  const posted = await docs.eligibility(env.identity, b.id);
  expect(posted.canPost).toBe(false);
  expect(posted.canPay).toBe(true);
  expect(posted.blockedReason).toBeNull();

  const payment = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId,
    bankAccountId: env.bankAccountId,
    paymentDate: env.periods.openStart.toISOString().slice(0, 10),
    currencyCode: 'USD',
    totalAmount: 250,
    paymentMethod: 'BANK_TRANSFER',
    allocations: [{ supplierBillId: b.id, amount: 250 }],
  });

  const held = await docs.eligibility(env.identity, b.id);
  expect(held.canPay).toBe(false);
  expect(held.blockedReason).toBe('PAYMENT_AWAITING_APPROVAL');
  expect(held.paymentsInFlight).toBe(1);
  await expect(
    svc.supplierPaymentService.create(env.identity, {
      supplierId: env.supplierId,
      bankAccountId: env.bankAccountId,
      paymentDate: env.periods.openStart.toISOString().slice(0, 10),
      currencyCode: 'USD',
      totalAmount: 1,
      paymentMethod: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: b.id, amount: 1 }],
    }),
  ).rejects.toThrow(/exceeds bill outstanding/);

  // ELIG-05 — the payment belongs to project A (bill header), not B.
  const inA = await svc.supplierPaymentService.findAll(env.identity, undefined, projectA);
  const inB = await svc.supplierPaymentService.findAll(env.identity, undefined, projectB);
  expect(inA.map((p) => p.id)).toContain(payment.id);
  expect(inB.map((p) => p.id)).not.toContain(payment.id);
});

test('ELIG-05 a payment for a bill coded to a project on a LINE belongs to that project', async () => {
  const b = await bill({ amount: 40, lineProjectId: projectB });
  await post(b.id);
  const payment = await svc.supplierPaymentService.create(env.identity, {
    supplierId: env.supplierId,
    bankAccountId: env.bankAccountId,
    paymentDate: env.periods.openStart.toISOString().slice(0, 10),
    currencyCode: 'USD',
    totalAmount: 40,
    paymentMethod: 'BANK_TRANSFER',
    allocations: [{ supplierBillId: b.id, amount: 40 }],
  });
  expect((await svc.supplierPaymentService.findAll(env.identity, undefined, projectB)).map((p) => p.id)).toContain(payment.id);
  expect((await svc.supplierPaymentService.findAll(env.identity, undefined, projectA)).map((p) => p.id)).not.toContain(payment.id);
});

test('ELIG-06 receipts filter by the project of the invoices they are allocated to', async () => {
  const invoice = await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId,
      clientId: env.clientId,
      projectId: projectA,
      invoiceDate: env.periods.openStart,
      dueDate: env.periods.openEnd,
      currencyCode: 'USD',
      subtotal: new Decimal(80),
      vatAmount: new Decimal(0),
      totalAmount: new Decimal(80),
      outstandingAmount: new Decimal(80),
      billingAddressSnapshot: {},
      documentStatus: 'APPROVED',
      postingStatus: 'POSTED',
      createdBy: env.identity.userId,
    },
  });
  const mk = () =>
    prisma.paymentReceipt.create({
      data: {
        organizationId: env.orgId,
        clientId: env.clientId,
        bankAccountId: env.bankAccountId,
        receiptDate: env.periods.openStart,
        accountingDate: env.periods.openStart,
        totalAmount: new Decimal(80),
        allocatedAmount: new Decimal(0),
        unallocatedAmount: new Decimal(80),
        currencyCode: 'USD',
        documentStatus: 'APPROVED',
        postingStatus: 'NOT_POSTED',
        createdBy: env.identity.userId,
      },
    });
  const allocated = await mk();
  const onAccount = await mk();
  await prisma.clientReceiptAllocation.create({
    data: {
      organizationId: env.orgId,
      paymentReceiptId: allocated.id,
      clientInvoiceId: invoice.id,
      allocatedAmount: new Decimal(80),
      allocationDate: env.periods.openStart,
      createdBy: env.identity.userId,
    },
  });
  const inA = (await svc.customerReceiptService.findAll(env.identity, undefined, projectA)).map((r) => r.id);
  expect(inA).toContain(allocated.id);
  expect(inA).not.toContain(onAccount.id); // an unallocated receipt belongs to no project
  expect((await svc.customerReceiptService.findAll(env.identity, undefined, projectB)).map((r) => r.id)).not.toContain(allocated.id);
  // Unfiltered still lists both.
  const all = (await svc.customerReceiptService.findAll(env.identity)).map((r) => r.id);
  expect(all).toEqual(expect.arrayContaining([allocated.id, onAccount.id]));
});

test('ELIG-07 journals filter by a line coded to the project', async () => {
  const coded = await svc.manualJournalService.create(env.identity, {
    accountingDate: env.periods.openStart.toISOString().slice(0, 10),
    description: 'ELIG coded',
    currencyCode: 'USD',
    lines: [
      { accountId: env.accounts.expId, debitAmount: 10, projectId: projectA },
      { accountId: env.accounts.bankId, creditAmount: 10 },
    ],
  } as never);
  const plain = await svc.manualJournalService.create(env.identity, {
    accountingDate: env.periods.openStart.toISOString().slice(0, 10),
    description: 'ELIG plain',
    currencyCode: 'USD',
    lines: [
      { accountId: env.accounts.expId, debitAmount: 5 },
      { accountId: env.accounts.bankId, creditAmount: 5 },
    ],
  } as never);
  const inA = (await svc.manualJournalService.findAll(env.identity, projectA)).map((j) => j.id);
  expect(inA).toContain(coded.id);
  expect(inA).not.toContain(plain.id);
  expect((await svc.manualJournalService.findAll(env.identity, projectB)).map((j) => j.id)).not.toContain(coded.id);
});

test('ELIG-08 an opening-balance bill: not postable (409), not payable, said plainly', async () => {
  const b = await bill({});
  await prisma.supplierBill.update({ where: { id: b.id }, data: { postingStatus: 'OPENING_BALANCE' } });
  const e = await docs.eligibility(env.identity, b.id);
  expect(e.canPost).toBe(false);
  expect(e.canPay).toBe(false);
  expect(e.blockedReason).toBe('OPENING_BALANCE_NOT_PAYABLE');
  await expect(post(b.id)).rejects.toThrow(/opening balance/);
  await expect(
    svc.supplierPaymentService.create(env.identity, {
      supplierId: env.supplierId,
      bankAccountId: env.bankAccountId,
      paymentDate: env.periods.openStart.toISOString().slice(0, 10),
      currencyCode: 'USD',
      totalAmount: 1,
      paymentMethod: 'BANK_TRANSFER',
      allocations: [{ supplierBillId: b.id, amount: 1 }],
    }),
  ).rejects.toThrow(/not POSTED/);
});
