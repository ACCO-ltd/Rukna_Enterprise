/**
 * Receivables aging, AG (2026-10-30) — live DB.
 *
 *   AG-01  as of a past day: an invoice at its balance that day (before a payment, after it, before
 *          a credit note), not yet existing before it was issued
 *   AG-02  money a client paid ahead shows on account, and the net equals what they owe
 *   AG-03  a bounced payment counts while it stood, and the invoice owes again after
 *   AG-04  the aging total agrees with the AR control account on the same day
 *   AG-05  a future day is refused (the payables side has its own spec, AA)
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { transferProof } from '../../__tests__/helpers/payment-proof';
import { FinanceHomeRepository } from '../infrastructure/finance-home.repository';
import { AgingReportService } from '../application/aging-report.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let aging: AgingReportService;
let invoiceId: string;
const viewer = () => ({ ...env.identity, permissions: [PERMISSIONS.receivablesManage] });
const day = (n: number) => new Date(env.periods.openStart.getTime() + n * 86_400_000).toISOString().slice(0, 10);
const report = (asOf?: string) => aging.report(viewer(), 'receivables', asOf);
const ours = async (asOf?: string) => (await report(asOf)).rows.find((r) => r.partyId === env.clientId);

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  aging = new AgingReportService({ getClient: () => prisma } as never, new FinanceHomeRepository());
  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
    ['22000', 'Sales tax payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'],
  ] as const) {
    const a = await prisma.account.create({ data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId } });
    await prisma.accountVersion.create({
      data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
    });
  }
  // Day 2: invoice 1000 + 5% = 1050, due day 12. Day 5: 400 received and applied, plus 100 paid
  // ahead. Day 7: a 50 cheque applied; it bounces on day 9.
  const inv = await svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId, invoiceDate: day(2), dueDate: day(12), currencyCode: 'USD',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: '1000.00', revenueAccountCode: '42100' }],
  });
  await svc.clientInvoiceService.issue(env.identity, inv.id);
  invoiceId = inv.id;
  const receive = (date: string, amount: string, applied: number) =>
    svc.customerReceiptService.receive(env.identity, {
      ...transferProof(date), clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: date, amount, currency: 'USD',
      allocations: applied ? [{ clientInvoiceId: inv.id, amount: applied }] : [],
    });
  await receive(day(5), '500.00', 400);
  const bounced = await receive(day(7), '50.00', 50);
  await svc.customerReceiptService.reverse(env.identity, bounced.id, { reversalDate: day(9), reason: 'Cheque bounced' });
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('AG-01: as of a past day, the invoice is at its balance that day', async () => {
  expect((await ours(day(1)))).toBeUndefined();
  const issued = await ours(day(3));
  expect(issued?.total).toBe('1050.00');
  expect(issued?.documents.map((d) => d.id)).toEqual([invoiceId]);
  expect((await ours(day(5)))?.total).toBe('650.00');
  // Past its due date by day 20: 8 days late.
  const late = await ours(day(20));
  expect(late?.buckets.d1_30).toBe('650.00'); // the bounced 50 owed again
  expect(late?.documents[0]!.daysLate).toBe(8);
  expect((await report(day(3))).historical).toBe(true);
});

it('AG-02: money paid ahead is on account, and the net is what the client owes', async () => {
  const row = await ours(day(5));
  expect(row).toMatchObject({ total: '650.00', onAccount: '100.00', netBalance: '550.00', retentionHeld: '0.00' });
  const today = await ours();
  expect(today).toMatchObject({ total: '650.00', onAccount: '100.00', netBalance: '550.00' });
});

it('AG-03: a bounced payment counts while it stood, and the invoice owes it again after', async () => {
  expect((await ours(day(7)))?.total).toBe('600.00');
  expect((await ours(day(9)))?.total).toBe('650.00');
});

it('AG-04: the aging total agrees with the AR control account on the same day', async () => {
  for (const asOf of [day(3), day(7), undefined]) {
    const r = await report(asOf);
    expect(r.ledger).toMatchObject({ agrees: true, difference: '0.00' });
    expect(r.ledger!.balance).toBe(r.total);
  }
});

it('AG-05: a future day is refused', async () => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  await expect(report(tomorrow)).rejects.toMatchObject({ response: { errorCode: 'AS_OF_INVALID' } });
});
