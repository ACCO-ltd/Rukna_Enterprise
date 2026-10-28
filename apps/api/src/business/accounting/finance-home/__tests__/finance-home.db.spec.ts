/**
 * Step 4 — Finance Home figures from the live ledger.
 *
 *   FH-01  an issued invoice part-paid into the bank shows as cash, receivable (aged) and month activity
 *   FH-02  a caller with only manage:receivable sees receivables, not cash or the month
 */

import { PrismaClient } from '@prisma/client';
import { PERMISSIONS } from '@erp/types';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { FinanceHomeService } from '../application/finance-home.service';
import { FinanceHomeRepository } from '../infrastructure/finance-home.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let home: FinanceHomeService;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  home = new FinanceHomeService({ getClient: () => prisma } as never, new FinanceHomeRepository());
  for (const [code, name, accountClass, subtype] of [
    ['42100', 'Equipment hire income', 'INCOME', 'OTHER_INCOME'],
    ['22000', 'Sales tax payable', 'LIABILITY', 'VAT_OUTPUT_PAYABLE'],
  ] as const) {
    const a = await prisma.account.create({ data: { id: `${env.orgId}-${code}`, organizationId: env.orgId, code, normalBalance: 'CREDIT', createdBy: env.identity.userId } });
    await prisma.accountVersion.create({
      data: { accountId: a.id, versionNumber: 1, name, accountClass, accountSubtype: subtype, isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2020-01-01'), changedBy: env.identity.userId },
    });
  }
  const openDay = env.periods.openStart.toISOString().slice(0, 10);
  const inv = await svc.clientInvoiceService.createManual(env.identity, {
    clientId: env.clientId,
    invoiceDate: openDay,
    dueDate: openDay,
    currencyCode: 'USD',
    paymentTerms: 'Due on receipt',
    lines: [{ description: 'Crane hire', quantity: '1', unitPrice: '1000.00', revenueAccountCode: '42100' }],
  });
  await svc.clientInvoiceService.issue(env.identity, inv.id);
  await svc.customerReceiptService.receive(env.identity, {
    clientId: env.clientId, bankAccountId: env.bankAccountId, receiptDate: openDay, amount: '400.00', currency: 'USD',
    allocations: [{ clientInvoiceId: inv.id, amount: 400 }],
  });
}, 60_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

it('FH-01: cash, aged receivables and the month come from the ledger', async () => {
  // "Today" is 45 days after the due date, inside the open period's month for the month figures.
  const due = env.periods.openStart;
  const today = new Date(due.getTime() + 45 * 86_400_000);
  const r = await home.home({ ...env.identity, permissions: [PERMISSIONS.accountingView] }, today);

  expect(r.cash?.accounts.find((a) => a.bankAccountId === env.bankAccountId)?.balance).toBe('400.00');
  // 1000 + 5% tax = 1050, less 400 received.
  expect(r.receivables).toMatchObject({ outstanding: '650.00', overdue: '650.00' });
  expect(r.receivables?.aging.find((b) => b.key === 'd31_60')).toEqual({ key: 'd31_60', amount: '650.00', count: 1 });
  expect(r.receivables?.topOverdue[0]).toMatchObject({ clientId: env.clientId, overdue: '650.00', oldestDaysLate: 45 });

  const inMonth = await home.home({ ...env.identity, permissions: [PERMISSIONS.accountingView] }, due);
  expect(inMonth.month).toMatchObject({ invoiced: '1050.00', collected: '400.00' });
});

it('FH-02: a receivables clerk sees receivables only', async () => {
  const r = await home.home({ ...env.identity, permissions: [PERMISSIONS.receivablesManage] });
  expect(r.receivables).not.toBeNull();
  expect(r.cash).toBeNull();
  expect(r.payables).toBeNull();
  expect(r.month).toBeNull();
});
