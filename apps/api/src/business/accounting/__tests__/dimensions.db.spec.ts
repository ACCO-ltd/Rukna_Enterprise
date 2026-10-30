/**
 * Step 6 — ledger dimensions, fixed forward (owner decision 2026-10-28: posted history is left as
 * it is; new postings carry full tags).
 *
 *   DIM-01  every line of a posted invoice — AR, revenue and VAT — names the client; its reversal too
 *   DIM-02  a customer receipt's bank line names the client; a supplier payment's bank line the supplier
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, type AccountingServices } from './helpers/build-services';
import { transferProof } from './helpers/payment-proof';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let day: string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
    ['22000', 'Sales tax payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'],
  ] as const) {
    const a = await prisma.account.create({ data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId } });
    await prisma.accountVersion.create({
      data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
    });
  }
  day = env.periods.openStart.toISOString().slice(0, 10);
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const linesOf = (journalEntryId: string | null) =>
  prisma.journalLine.findMany({ where: { journalEntryId: journalEntryId! }, select: { clientId: true, supplierId: true, taxCodeId: true, account: { select: { code: true } } } });

it('DIM-01: every line of an invoice, and of its reversal, names the client', async () => {
  const inv = await svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId, invoiceDate: day, dueDate: day, currencyCode: 'USD', paymentTerms: 'Due on receipt',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: '1000.00', revenueAccountCode: '42100' }],
  });
  await svc.clientInvoiceService.issue(env.identity, inv.id);
  const posted = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  const lines = await linesOf(posted.postedJournalEntryId);
  expect(lines.map((l) => l.account.code).sort()).toEqual(['22000', '42100', env.accounts.arCode].sort());
  expect(lines.every((l) => l.clientId === env.clientId)).toBe(true);
  if (posted.taxCodeId) expect(lines.find((l) => l.account.code === '22000')!.taxCodeId).toBe(posted.taxCodeId);

  await svc.clientInvoiceService.reverse(env.identity, inv.id, { reversalDate: day, reason: 'Test' });
  const reversed = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
  const back = await linesOf(reversed.reversalJournalEntryId);
  expect(back).toHaveLength(3);
  expect(back.every((l) => l.clientId === env.clientId)).toBe(true);
});

it('DIM-02: bank lines name the client who paid and the supplier who was paid', async () => {
  const receipt = await svc.customerReceiptService.receive(env.identity, {
    ...transferProof(),
    clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: day, amount: '250.00', currency: 'USD', allocations: [],
  });
  const r = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: (receipt as { id: string }).id } });
  const receiptLines = await linesOf(r.postedJournalEntryId);
  expect(receiptLines.length).toBeGreaterThan(1);
  expect(receiptLines.every((l) => l.clientId === env.clientId)).toBe(true);

  const payment = await prisma.supplierPayment.create({
    data: {
      organizationId: env.orgId, supplierId: env.supplierId, bankAccountId: env.bankAccountId,
      paymentDate: env.periods.openStart, accountingDate: env.periods.openStart, currencyCode: 'USD',
      totalAmount: new Decimal(300), allocatedAmount: new Decimal(0), unallocatedAmount: new Decimal(300),
      paymentMethod: 'BANK_TRANSFER', documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED', createdBy: env.identity.userId,
    },
  });
  await svc.supplierPaymentService.post(env.identity, {
    paymentId: payment.id, apAccountCode: env.accounts.apCode, bankGlCode: env.accounts.bankCode, supplierAdvanceCode: env.accounts.advOutCode,
  });
  const p = await prisma.supplierPayment.findUniqueOrThrow({ where: { id: payment.id } });
  const paymentLines = await linesOf(p.postedJournalEntryId);
  expect(paymentLines.find((l) => l.account.code === env.accounts.bankCode)!.supplierId).toBe(env.supplierId);
  expect(paymentLines.every((l) => l.supplierId === env.supplierId)).toBe(true);
});
