/**
 * Receipts audit (2026-10-30) — the guards on recording, posting, reversing and cancelling a
 * receipt (live DB).
 *
 *   RC-01  a reversed receipt cannot be posted again (the ledger's idempotency guard used to hand
 *          back the reversed journal while the invoices were paid again under a new number)
 *   RC-02  two posts of one receipt at the same moment: one journal, one number, one application
 *   RC-03  a receipt is recorded in USD, for more than nothing, from a known client
 *   RC-04  posting names a registered bank account that takes receipts, and records it
 *   RC-05  a reversal cannot be dated before the receipt, and two at once restore the invoice once
 *   RC-06  an unposted receipt can be cancelled with a reason; it cannot then be posted
 *   RC-07  the receipt read names its invoices and bank, says which applications came with posting,
 *          and journals name receipt and invoice numbers
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { transferProof } from '../../__tests__/helpers/payment-proof';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

const day = () => env.periods.openStart.toISOString().slice(0, 10);
const nextDay = () => new Date(env.periods.openStart.getTime() + 86_400_000).toISOString().slice(0, 10);

async function issuedInvoice(amount: string) {
  const inv = await svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId,
    invoiceDate: day(),
    dueDate: env.periods.openEnd.toISOString().slice(0, 10),
    currencyCode: 'USD',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: amount, revenueAccountCode: '42100' }],
  });
  await svc.clientInvoiceService.issue(env.identity, inv.id);
  return prisma.clientInvoice.findUniqueOrThrow({ where: { id: inv.id } });
}
const record = (patch: Record<string, unknown> = {}) =>
  svc.customerReceiptService.create(env.identity, {
    ...transferProof(),
    clientId: env.clientId,
    receiptDate: nextDay(),
    amount: '100.00',
    currency: 'USD',
    ...patch,
  } as never);
const owed = async (id: string) =>
  (await prisma.clientInvoice.findUniqueOrThrow({ where: { id } })).outstandingAmount.toFixed(2);

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
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('RC-01: a reversed receipt cannot be posted again', async () => {
  const invoice = await issuedInvoice('100.00');
  const total = invoice.totalAmount.toFixed(2);
  const receipt = await record({ amount: total });
  await svc.customerReceiptService.post(env.identity, {
    receiptId: receipt.id, bankAccountId: env.bankAccountId, allocations: [{ clientInvoiceId: invoice.id, amount: Number(total) }],
  });
  await svc.customerReceiptService.reverse(env.identity, receipt.id, { reversalDate: nextDay(), reason: 'Cheque bounced' });
  expect(await owed(invoice.id)).toBe(total);

  await expect(
    svc.customerReceiptService.post(env.identity, {
      receiptId: receipt.id, bankAccountId: env.bankAccountId, allocations: [{ clientInvoiceId: invoice.id, amount: Number(total) }],
    }),
  ).rejects.toMatchObject({ response: { errorCode: 'RECEIPT_ALREADY_POSTED' } });
  expect(await owed(invoice.id)).toBe(total);
  expect((await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).postingStatus).toBe('REVERSED');
});

it('RC-02: two posts at the same moment make one journal, one number and one application', async () => {
  const invoice = await issuedInvoice('50.00');
  const total = invoice.totalAmount.toFixed(2);
  const receipt = await record({ amount: '200.00' });
  const post = () =>
    svc.customerReceiptService.post(env.identity, {
      receiptId: receipt.id, bankAccountId: env.bankAccountId, allocations: [{ clientInvoiceId: invoice.id, amount: Number(total) }],
    });
  const results = await Promise.allSettled([post(), post()]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);

  expect(await prisma.journalEntry.count({ where: { sourceDocumentId: receipt.id, sourceDocumentType: 'PAYMENT_RECEIPT' } })).toBe(1);
  expect(await prisma.clientReceiptAllocation.count({ where: { paymentReceiptId: receipt.id } })).toBe(1);
  expect(await owed(invoice.id)).toBe('0.00');
});

it('RC-03: a receipt is recorded in USD, for more than nothing, from a known client', async () => {
  const before = await prisma.paymentReceipt.count({ where: { organizationId: env.orgId } });
  await expect(record({ currency: 'EUR' })).rejects.toMatchObject({ response: { errorCode: 'CURRENCY_NOT_SUPPORTED' } });
  await expect(record({ amount: '0' })).rejects.toMatchObject({ response: { errorCode: 'AMOUNT_NOT_POSITIVE' } });
  await expect(record({ amount: '-5.00' })).rejects.toMatchObject({ response: { errorCode: 'AMOUNT_NOT_POSITIVE' } });
  await expect(record({ clientId: 'no-such-client' })).rejects.toMatchObject({ response: { errorCode: 'CLIENT_NOT_FOUND' } });
  expect(await prisma.paymentReceipt.count({ where: { organizationId: env.orgId } })).toBe(before);

  const ok = await record({ paymentMethod: 'CHEQUE', reference: '  CHQ-118  ' });
  expect(ok.paymentMethod).toBe('CHEQUE');
  expect(ok.reference).toBe('CHQ-118');
});

it('RC-04: posting needs a registered bank account that takes receipts, and records it', async () => {
  const receipt = await record();
  await prisma.bankAccount.update({ where: { id: env.bankAccountId }, data: { status: 'SUSPENDED' } });
  try {
    await expect(
      svc.customerReceiptService.post(env.identity, { receiptId: receipt.id, bankAccountId: env.bankAccountId }),
    ).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_NOT_RECEIVING' } });
    await expect(
      svc.customerReceiptService.post(env.identity, { receiptId: receipt.id, bankAccountCode: env.accounts.bankCode }),
    ).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_NOT_RECEIVING' } });
  } finally {
    await prisma.bankAccount.update({ where: { id: env.bankAccountId }, data: { status: 'ACTIVE' } });
  }
  // A GL code that is not a registered bank account (here: revenue) is refused.
  await expect(
    svc.customerReceiptService.post(env.identity, { receiptId: receipt.id, bankAccountCode: env.accounts.revCode }),
  ).rejects.toMatchObject({ response: { errorCode: 'BANK_ACCOUNT_NOT_FOUND' } });

  await svc.customerReceiptService.post(env.identity, { receiptId: receipt.id, bankAccountCode: env.accounts.bankCode });
  expect((await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receipt.id } })).bankAccountId).toBe(env.bankAccountId);
});

it('RC-05: a reversal is not dated before the receipt, and two at once restore the invoice once', async () => {
  const invoice = await issuedInvoice('40.00');
  const total = invoice.totalAmount.toFixed(2);
  const receipt = await record({ amount: total });
  await svc.customerReceiptService.post(env.identity, {
    receiptId: receipt.id, bankAccountId: env.bankAccountId, allocations: [{ clientInvoiceId: invoice.id, amount: Number(total) }],
  });
  await expect(
    svc.customerReceiptService.reverse(env.identity, receipt.id, { reversalDate: day(), reason: 'Wrong client' }),
  ).rejects.toMatchObject({ response: { errorCode: 'REVERSAL_BEFORE_RECEIPT' } });

  const reverse = () => svc.customerReceiptService.reverse(env.identity, receipt.id, { reversalDate: nextDay(), reason: 'Wrong client' });
  const results = await Promise.allSettled([reverse(), reverse()]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await owed(invoice.id)).toBe(total);
  expect(await prisma.journalEntry.count({ where: { sourceDocumentId: `reversal-${receipt.id}` } })).toBe(1);
});

it('RC-06: an unposted receipt is cancelled with a reason and cannot then be posted', async () => {
  const receipt = await record({ reference: 'TYPED-TWICE' });
  await expect(svc.customerReceiptService.cancel(env.identity, receipt.id, ' ')).rejects.toMatchObject({
    response: { errorCode: 'CANCELLATION_REASON_REQUIRED' },
  });
  const cancelled = await svc.customerReceiptService.cancel(env.identity, receipt.id, 'Recorded twice');
  expect(cancelled.documentStatus).toBe('CANCELLED');
  expect(cancelled.cancellationReason).toBe('Recorded twice');
  expect(cancelled.cancelledBy).toBe(env.identity.userId);

  await expect(
    svc.customerReceiptService.post(env.identity, { receiptId: receipt.id, bankAccountId: env.bankAccountId }),
  ).rejects.toMatchObject({ response: { errorCode: 'RECEIPT_CANCELLED' } });
  await expect(svc.customerReceiptService.cancel(env.identity, receipt.id, 'Again')).rejects.toMatchObject({
    response: { errorCode: 'RECEIPT_NOT_CANCELLABLE' },
  });

  const posted = await record();
  await svc.customerReceiptService.post(env.identity, { receiptId: posted.id, bankAccountId: env.bankAccountId });
  await expect(svc.customerReceiptService.cancel(env.identity, posted.id, 'Too late')).rejects.toMatchObject({
    response: { errorCode: 'RECEIPT_NOT_CANCELLABLE' },
  });
});

it('RC-07: the receipt read names invoices and bank; journals name receipt and invoice numbers', async () => {
  const first = await issuedInvoice('30.00');
  const second = await issuedInvoice('20.00');
  const receipt = await svc.customerReceiptService.receive(env.identity, {
    ...transferProof(),
    clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: nextDay(), amount: '100.00', currency: 'USD',
    paymentMethod: 'BANK_TRANSFER', allocations: [{ clientInvoiceId: first.id, amount: Number(first.totalAmount) }],
  });
  await svc.customerReceiptService.allocate(env.identity, {
    receiptId: receipt.id, clientInvoiceId: second.id, amount: Number(second.totalAmount),
  });

  const detail = await svc.customerReceiptService.findById(env.identity, receipt.id);
  expect(detail.bankAccount?.id).toBe(env.bankAccountId);
  expect(detail.refundedAmount).toBe('0.00');
  const atPosting = detail.allocations.find((a) => a.clientInvoiceId === first.id)!;
  const later = detail.allocations.find((a) => a.clientInvoiceId === second.id)!;
  expect(atPosting).toMatchObject({ atPosting: true, invoiceNumber: first.invoiceNumber });
  expect(later).toMatchObject({ atPosting: false, invoiceNumber: second.invoiceNumber });

  const applied = await prisma.journalEntry.findFirstOrThrow({ where: { id: later.journalEntryId! } });
  expect(applied.description).toBe(`Receipt ${detail.receiptNumber} applied to invoice ${second.invoiceNumber}`);

  // An application cannot be undone through another receipt's address.
  await expect(
    svc.customerReceiptService.reverseAllocation(env.identity, later.id, {}, 'another-receipt'),
  ).rejects.toThrow(/is not on receipt/);
  const twice = () => svc.customerReceiptService.reverseAllocation(env.identity, later.id, {}, receipt.id);
  const results = await Promise.allSettled([twice(), twice()]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await owed(second.id)).toBe(second.totalAmount.toFixed(2));
  const undo = await prisma.journalEntry.findFirstOrThrow({ where: { sourceDocumentId: `alloc-reversal-${later.id}` } });
  expect(undo.description).toBe(`Undo: receipt ${detail.receiptNumber} applied to invoice ${second.invoiceNumber}`);
});
