/**
 * Step 6 — the month-end close checklist, read live.
 *
 *   CL-01  an unposted invoice in the month shows under documents and blocks lock and close;
 *          AR/AP tie out; the bank is shown, not blocking, while the policy is off
 *   CL-02  with the banking policy on, the close gate itself refuses a month whose bank is not
 *          reconciled to its end; a reconciled statement reaching the end clears it
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../../__tests__/helpers/build-services';
import { VatReportService } from '../../vat-report/application/vat-report.service';
import { VatReportRepository } from '../../vat-report/infrastructure/vat-report.repository';
import { CloseChecklistService } from '../application/close-checklist.service';
import { CloseChecklistRepository } from '../infrastructure/close-checklist.repository';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let checklist: CloseChecklistService;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  const tenancy = { getClient: () => prisma } as never;
  checklist = new CloseChecklistService(
    new CloseChecklistRepository(tenancy),
    svc.periodManagementService,
    new VatReportService(tenancy, new VatReportRepository()),
    { record: async () => undefined } as never,
  );
  await prisma.bankAccount.update({ where: { id: env.bankAccountId }, data: { isReconcilable: true, status: 'ACTIVE' } });
  await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId, clientId: env.clientId, sourceIpcId: null, invoiceDate: env.periods.openStart, dueDate: env.periods.openEnd,
      currencyCode: 'USD', subtotal: new Decimal(100), vatAmount: new Decimal(0), totalAmount: new Decimal(100), outstandingAmount: new Decimal(100),
      billingAddressSnapshot: {}, documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', createdBy: env.identity.userId,
    },
  });
}, 60_000);

afterAll(async () => {
  await prisma.$executeRaw`DELETE FROM banking_policy WHERE organization_id = ${env.orgId}`;
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const byKey = (c: Awaited<ReturnType<CloseChecklistService['checklist']>>) => new Map(c.checks.map((x) => [x.key, x]));

it('CL-01: an unposted invoice blocks lock and close; tie-out done; bank shown but not blocking', async () => {
  const c = await checklist.checklist(env.identity, env.periods.openId);
  const checks = byKey(c);
  expect(c.period.id).toBe(env.periods.openId);
  expect(checks.get('documents')!.status).toBe('TODO');
  expect(checks.get('documents')!.items.find((i) => i.key === 'invoices')).toMatchObject({ count: 1, status: 'TODO' });
  expect(checks.get('lock')!.status).toBe('BLOCKED');
  expect(checks.get('close')!.status).toBe('BLOCKED');
  expect(checks.get('tie-out')!.status).toBe('DONE');
  expect(checks.get('banks')!.status).toBe('TODO');
  expect(checks.get('vat')!.status).toBe('INFO');
  expect(c.readyToClose).toBe(false);
  expect(c.requireBankReconciliation).toBe(false);
});

it('CL-02: with the policy on, the close gate refuses an unreconciled bank until a statement reaches the end', async () => {
  await checklist.setRequireBankReconciliation(env.identity, true);
  const gate = await svc.periodManagementService.validateCloseGate(env.identity, env.periods.lockedId);
  expect(gate.blockers.some((b) => b.includes('is not reconciled to'))).toBe(true);
  expect(byKey(await checklist.checklist(env.identity, env.periods.lockedId)).get('banks')!.status).toBe('BLOCKED');

  await prisma.bankStatement.create({
    data: {
      organizationId: env.orgId, bankAccountId: env.bankAccountId, periodStart: env.periods.lockedStart, statementDate: env.periods.lockedEnd,
      currencyCode: 'USD', openingBalance: 0, closingBalance: 0, status: 'RECONCILED', reconciledAt: new Date(), createdBy: env.identity.userId,
    },
  });
  const after = await svc.periodManagementService.validateCloseGate(env.identity, env.periods.lockedId);
  expect(after.blockers.some((b) => b.includes('is not reconciled to'))).toBe(false);
  expect(byKey(await checklist.checklist(env.identity, env.periods.lockedId)).get('banks')!.status).toBe('DONE');
});
