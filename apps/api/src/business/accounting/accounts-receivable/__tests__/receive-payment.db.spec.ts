/**
 * ADR-046 §6 — receive a customer payment straight into a bank account (live DB).
 *
 *   RP-01  one action records, posts (Dr bank / Cr AR) and applies the receipt; the invoice falls
 *   RP-02  money beyond what is applied stays unapplied on the client (Cr Unapplied)
 *   RP-03  refused, before anything is written: another client's invoice, an unissued invoice,
 *          more than an invoice owes, a bank account in another currency
 *   RP-04  AR-2: reversing a receipt (bounced cheque) records when, who and why, posts the mirror,
 *          and the invoice owes again; it needs a reason and refuses after later applications
 *   RP-05  CI-3: the invoice read says what settled it — payments listed, reversed ones left out —
 *          and total = paid + credited + written off + still owed
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { transferProof } from '../../__tests__/helpers/payment-proof';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let issuedId: string;
let draftId: string;

const day = () => env.periods.openStart.toISOString().slice(0, 10);
const sale = (amount: string) => ({
  clientId: env.clientId,
  invoiceDate: day(),
  dueDate: env.periods.openEnd.toISOString().slice(0, 10),
  currencyCode: 'USD',
  paymentTerms: 'Net 15',
  lines: [{ description: 'Crane hire', quantity: '1', unitPrice: amount, revenueAccountCode: '42100' }],
});
const receive = (patch: Record<string, unknown> = {}) =>
  svc.customerReceiptService.receive(env.identity, {
    ...transferProof(),
    clientId: env.clientId,
    bankAccountId: env.bankAccountId,
    receiptDate: day(),
    amount: '400.00',
    currency: 'USD',
    reference: 'TT-2210',
    allocations: [{ clientInvoiceId: issuedId, amount: 400 }],
    ...patch,
  });

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
  ] as const) {
    const a = await prisma.account.create({
      data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId },
    });
    await prisma.accountVersion.create({
      data: {
        accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype,
        isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId,
      },
    });
  }
  const issued = await svc.clientInvoiceService.createManual(env.identity, sale('1050.00'));
  await svc.clientInvoiceService.issue(env.identity, issued.id);
  issuedId = issued.id;
  draftId = (await svc.clientInvoiceService.createManual(env.identity, sale('50.00'))).id;
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const journalLines = async (receiptId: string) => {
  const r = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  return prisma.journalLine.findMany({ where: { journalEntryId: r.postedJournalEntryId! } });
};

it('RP-01: one action records, posts and applies the payment to the chosen bank', async () => {
  const receipt = await receive();
  expect(receipt.postingStatus).toBe('POSTED');
  expect(receipt.receiptNumber).toMatch(/^RCP-/);
  expect(receipt.bankAccountId).toBe(env.bankAccountId);

  const lines = await journalLines(receipt.id);
  const on = (accountId: string) => lines.find((l) => l.accountId === accountId);
  expect(on(env.accounts.bankId)?.debitAmount.toFixed(2)).toBe('400.00');
  expect(on(env.accounts.arId)?.creditAmount.toFixed(2)).toBe('400.00');
  expect(on(env.accounts.unaplId)).toBeUndefined();

  const invoice = await prisma.clientInvoice.findUniqueOrThrow({ where: { id: issuedId } });
  expect(invoice.outstandingAmount.toFixed(2)).toBe('650.00');
});

it('RP-02: what is not applied stays unapplied on the client', async () => {
  const receipt = await receive({ amount: '700.00', allocations: [{ clientInvoiceId: issuedId, amount: 600 }] });
  const lines = await journalLines(receipt.id);
  expect(lines.find((l) => l.accountId === env.accounts.arId)?.creditAmount.toFixed(2)).toBe('600.00');
  expect(lines.find((l) => l.accountId === env.accounts.unaplId)?.creditAmount.toFixed(2)).toBe('100.00');
  expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id: issuedId } })).outstandingAmount.toFixed(2)).toBe('50.00');
});

it('RP-03: refuses, before writing anything, what the payment cannot settle', async () => {
  const before = await prisma.paymentReceipt.count({ where: { organizationId: env.orgId } });

  await expect(receive({ allocations: [{ clientInvoiceId: draftId, amount: 10 }] })).rejects.toThrow(/not issued yet/);
  await expect(receive({ allocations: [{ clientInvoiceId: issuedId, amount: 60 }] })).rejects.toThrow(/has 50.00 outstanding/);

  const other = await prisma.client.create({ data: { organizationId: env.orgId, code: 'CLI-002', name: 'Other Client', status: 'ACTIVE' } });
  await expect(receive({ clientId: other.id })).rejects.toMatchObject({ response: { errorCode: 'ALLOCATION_CLIENT_MISMATCH' } });

  await expect(receive({ currency: 'EUR', allocations: [] })).rejects.toMatchObject({ response: { errorCode: 'CURRENCY_NOT_SUPPORTED' } });

  expect(await prisma.paymentReceipt.count({ where: { organizationId: env.orgId } })).toBe(before);
});

it('RP-04: reversing a receipt records why, mirrors the journal, and the invoice owes again', async () => {
  const before = (await prisma.clientInvoice.findUniqueOrThrow({ where: { id: issuedId } })).outstandingAmount.toFixed(2);
  const receipt = await receive({ amount: '30.00', allocations: [{ clientInvoiceId: issuedId, amount: 30 }] });
  await expect(
    svc.customerReceiptService.reverse(env.identity, receipt.id, { reversalDate: day(), reason: ' ' }),
  ).rejects.toMatchObject({ response: { errorCode: 'REVERSAL_REASON_REQUIRED' } });

  await svc.customerReceiptService.reverse(env.identity, receipt.id, { reversalDate: day(), reason: 'Cheque bounced' });
  const after = await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } });
  expect(after.postingStatus).toBe('REVERSED');
  expect(after.reversalReason).toBe('Cheque bounced');
  expect(after.reversedBy).toBe(env.identity.userId);
  expect(after.reversedAt).not.toBeNull();
  const mirror = await prisma.journalLine.findMany({ where: { journalEntryId: after.reversalJournalEntryId! } });
  expect(mirror.find((l) => l.accountId === env.accounts.bankId)?.creditAmount.toFixed(2)).toBe('30.00');
  expect((await prisma.clientInvoice.findUniqueOrThrow({ where: { id: issuedId } })).outstandingAmount.toFixed(2)).toBe(before);
});

it('RP-05 (CI-3): the invoice lists its payments and ties out, leaving reversed receipts out', async () => {
  const detail = await svc.clientInvoiceService.findById(env.identity, issuedId);
  const live = await prisma.clientReceiptAllocation.findMany({
    where: { clientInvoiceId: issuedId, postingStatus: 'POSTED' },
  });
  expect(detail.payments.map((p) => p.amount).sort()).toEqual(live.map((a) => a.allocatedAmount.toFixed(2)).sort());
  // RP-04's bounced 30.00 receipt is not a payment any more.
  expect(detail.payments.every((p) => p.receiptNumber?.startsWith('RCP-'))).toBe(true);
  expect(detail.payments.some((p) => p.amount === '30.00')).toBe(false);

  const cents = (v: string) => Math.round(Number(v) * 100);
  expect(cents(detail.amountPaid)).toBe(detail.payments.reduce((s, p) => s + cents(p.amount), 0));
  expect(
    cents(detail.amountPaid) + cents(detail.amountCredited) + cents(detail.amountWrittenOff) + cents(detail.outstandingAmount.toString()),
  ).toBe(cents(detail.totalAmount.toString()));
});
