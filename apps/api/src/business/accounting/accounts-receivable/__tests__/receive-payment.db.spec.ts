/**
 * ADR-046 §6 — receive a customer payment straight into a bank account (live DB).
 *
 *   RP-01  one action records, posts (Dr bank / Cr AR) and applies the receipt; the invoice falls
 *   RP-02  money beyond what is applied stays unapplied on the client (Cr Unapplied)
 *   RP-03  refused, before anything is written: another client's invoice, an unissued invoice,
 *          more than an invoice owes, a bank account in another currency
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';

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
    ['22000', 'Sales tax payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'],
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
  // The fixture org charges 5%: 1000 → 1050.
  const issued = await svc.clientInvoiceService.createManual(env.identity, sale('1000.00'));
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

  await expect(receive({ currency: 'EUR', allocations: [] })).rejects.toMatchObject({ response: { errorCode: 'CURRENCY_MISMATCH' } });

  expect(await prisma.paymentReceipt.count({ where: { organizationId: env.orgId } })).toBe(before);
});
