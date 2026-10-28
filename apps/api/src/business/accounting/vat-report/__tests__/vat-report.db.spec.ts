/**
 * Step 6 — the VAT report reads output VAT from the ledger.
 *
 *   VR-01  two posted invoices and the reversal of one: by rate, by document, the reversal as its own
 *          negative line, and a total equal to the VAT account's movement
 *   VR-02  a journal straight to the VAT account is an adjustment; a period with nothing is empty;
 *          a bad period is refused
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { VatReportService } from '../application/vat-report.service';
import { VatReportRepository } from '../infrastructure/vat-report.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let vat: VatReportService;
let from: string;
let to: string;
let vatAccountId: string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  vat = new VatReportService({ getClient: () => prisma } as never, new VatReportRepository());
  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
    ['22000', 'Sales tax payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'],
  ] as const) {
    const a = await prisma.account.create({ data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId } });
    await prisma.accountVersion.create({
      data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
    });
  }
  vatAccountId = `${env.orgId}-22000`;
  from = env.periods.openStart.toISOString().slice(0, 10);
  to = new Date(env.periods.openStart.getTime() + 27 * 86_400_000).toISOString().slice(0, 10);
  const invoice = (unitPrice: string) => svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId, invoiceDate: from, dueDate: from, currencyCode: 'USD', paymentTerms: 'Due on receipt',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice, revenueAccountCode: '42100' }],
  });
  const a = await invoice('1000.00');
  const b = await invoice('400.00');
  await svc.clientInvoiceService.issue(env.identity, a.id);
  await svc.clientInvoiceService.issue(env.identity, b.id);
  await svc.clientInvoiceService.reverse(env.identity, b.id, { reversalDate: from, reason: 'Raised in error' });
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

async function vatMovement(): Promise<string> {
  const s = await prisma.journalLine.aggregate({
    where: { accountId: vatAccountId, entry: { status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { gte: new Date(from), lte: new Date(to) } } },
    _sum: { creditAmount: true, debitAmount: true },
  });
  return new Decimal(s._sum.creditAmount ?? 0).minus(s._sum.debitAmount ?? 0).toFixed(2);
}

it('VR-01: invoices and a reversal, by rate and document, agreeing with the ledger', async () => {
  const r = await vat.report(env.identity, from, to);
  // 5% on 1000 and on 400, then the 400 reversed: 50 + 20 − 20.
  expect(r.output.total).toBe('50.00');
  expect(r.output.total).toBe(await vatMovement());
  expect(r.output.invoices).toEqual({ count: 3, taxable: '1000.00', vat: '50.00' });
  expect(r.output.byRate).toEqual([{ rate: '5.0000', taxable: '1000.00', vat: '50.00' }]);
  const reversal = r.output.lines.find((l) => l.reversal)!;
  expect(reversal).toMatchObject({ kind: 'INVOICE', vat: '-20.00', taxableAmount: '-400.00' });
  expect(r.output.lines.every((l) => l.documentNumber?.startsWith('INV-'))).toBe(true);
  expect(r.closingBalance).toBe('50.00');
});

it('VR-02: a journal straight to the VAT account is an adjustment; empty periods; bad periods', async () => {
  await prisma.$transaction((tx) => svc.postingService.post({
    organizationId: env.orgId, accountingDate: new Date(from), documentDate: new Date(from), description: 'VAT correction',
    currencyCode: 'USD', eventType: 'EVT-MJ-001', sourceDocumentType: 'MANUAL_JOURNAL', sourceDocumentId: 'vr-02',
    journalCategory: 'GENERAL', entryPurpose: 'NORMAL', postingOrigin: 'MANUAL', createdBy: env.identity.userId,
    lines: [
      { accountId: `${env.orgId}-42100`, debitAmount: new Decimal(10), creditAmount: new Decimal(0), memo: 'x' },
      { accountId: vatAccountId, debitAmount: new Decimal(0), creditAmount: new Decimal(10), memo: 'x' },
    ],
  } as never, tx as never));
  const r = await vat.report(env.identity, from, to);
  expect(r.output.adjustments).toEqual({ count: 1, vat: '10.00' });
  expect(r.output.total).toBe('60.00');
  expect(r.output.total).toBe(await vatMovement());

  const empty = await vat.report(env.identity, '2001-01-01', '2001-01-31');
  expect(empty.output).toMatchObject({ total: '0.00', lines: [] });
  await expect(vat.report(env.identity, '2026-02-01', '2026-01-01')).rejects.toMatchObject({ response: { errorCode: 'PERIOD_INVALID' } });
});
