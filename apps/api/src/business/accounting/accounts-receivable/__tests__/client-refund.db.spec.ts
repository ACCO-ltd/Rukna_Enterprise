/**
 * AR-5 — paying back client cash held on account (live DB). Money leaves the bank, so it follows
 * the payment rule: up to the payment limit ($1,000 by default) it posts at once.
 *
 *   RF-01  up to the limit: Dr Unapplied / Cr bank, numbered; the receipt holds that much less
 *   RF-02  above the limit: waits; the requester cannot approve, someone else can; a waiting
 *          refund counts against what is on account
 *   RF-03  a receipt with a posted refund cannot be reversed; reversing the refund puts the cash
 *          back on account; the statement ties to open invoices less cash on account
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository';
import { ClientRefundService } from '../application/client-refund.service';
import { ClientStatementService } from '../application/client-statement.service';
import { ClientStatementRepository } from '../infrastructure/client-statement.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let refunds: ClientRefundService;
let receiptId: string;
let day: string;
const other = () => ({ ...env.identity, userId: 'second-approver' });

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  refunds = new ClientRefundService({ getClient: () => prisma } as never, svc.sequenceRepo, new PostingAccountResolver(new AccountRepository()), svc.postingService as never);
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
  const inv = await svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId, invoiceDate: day, dueDate: day, currencyCode: 'USD', paymentTerms: 'Due on receipt',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: '1000.00', revenueAccountCode: '42100' }],
  });
  await svc.clientInvoiceService.issue(env.identity, inv.id); // 1050
  // Paid 3,000: 1,050 applied, 1,950 on account.
  const receipt = await svc.customerReceiptService.receive(env.identity, {
    clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: day, amount: '3000.00', currency: 'USD', reference: 'TT-OVER',
    allocations: [{ clientInvoiceId: inv.id, amount: 1050 }],
  });
  receiptId = receipt.id;
}, 90_000);

afterAll(async () => {
  await prisma.clientRefund.deleteMany({ where: { organizationId: env.orgId } });
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const onAccount = async () => (await prisma.paymentReceipt.findUniqueOrThrow({ where: { id: receiptId } })).unallocatedAmount.toFixed(2);

it('RF-01: up to the payment limit it posts at once — Dr Unapplied / Cr bank', async () => {
  const r = await refunds.request(env.identity, { receiptId, bankAccountId: env.bankAccountId, amount: '150.00', refundDate: day, reason: 'Overpaid', reference: 'TT-RF1' });
  expect(r.status).toBe('POSTED');
  expect(r.refundNumber).toMatch(/^RF-/);
  const row = await prisma.clientRefund.findUniqueOrThrow({ where: { id: r.id } });
  const lines = await prisma.journalLine.findMany({ where: { journalEntryId: row.postedJournalEntryId! } });
  expect(lines.find((l) => l.accountId === env.accounts.unaplId)?.debitAmount.toFixed(2)).toBe('150.00');
  expect(lines.find((l) => l.accountId === env.accounts.bankId)?.creditAmount.toFixed(2)).toBe('150.00');
  expect(await onAccount()).toBe('1800.00');
});

it('RF-02: above the limit it waits; the requester cannot approve; someone else can', async () => {
  const r = await refunds.request(env.identity, { receiptId, bankAccountId: env.bankAccountId, amount: '1500.00', refundDate: day, reason: 'Contract cancelled' });
  expect(r.status).toBe('PENDING_APPROVAL');
  await expect(
    refunds.request(env.identity, { receiptId, bankAccountId: env.bankAccountId, amount: '400.00', refundDate: day, reason: 'Again' }),
  ).rejects.toMatchObject({ response: { errorCode: 'REFUND_EXCEEDS_ON_ACCOUNT', details: { available: '300.00' } } });
  await expect(refunds.approve(env.identity, r.id)).rejects.toMatchObject({ response: { errorCode: 'REFUND_SELF_APPROVAL' } });
  expect((await refunds.approve(other(), r.id)).status).toBe('POSTED');
  expect(await onAccount()).toBe('300.00');
});

it('RF-03: a refunded receipt cannot be reversed; reversing the refund restores the cash; the statement ties', async () => {
  await expect(
    svc.customerReceiptService.reverse(env.identity, receiptId, { reversalDate: day, reason: 'Wrong client' }),
  ).rejects.toMatchObject({ response: { errorCode: 'RECEIPT_HAS_REFUNDS' } });
  const [first] = await refunds.listForReceipt(env.identity, receiptId);
  expect((await refunds.reverse(env.identity, first!.id, { reversalDate: day, reason: 'Transfer bounced' })).status).toBe('REVERSED');
  expect(await onAccount()).toBe('450.00');

  const s = await new ClientStatementService({ getClient: () => prisma } as never, new ClientStatementRepository()).statement(env.identity, env.clientId, day, day);
  expect(s.lines.filter((l) => l.kind === 'REFUND')).toHaveLength(2);
  expect(s.lines.filter((l) => l.kind === 'REFUND_REVERSAL')).toHaveLength(1);
  expect(s.onAccount).toBe('450.00');
  const open = (await prisma.clientInvoice.findMany({ where: { organizationId: env.orgId, clientId: env.clientId, postingStatus: 'POSTED' } }))
    .reduce((sum, i) => sum.plus(i.outstandingAmount), new Decimal(0));
  expect(open.minus(s.onAccount).toFixed(2)).toBe(s.closingBalance);
});
