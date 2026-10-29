/**
 * GD — Accounting guided-flow read-model
 *
 *   GD-01  returns the four cycles in order; ready + setup DONE once the chart is complete
 *   GD-02  daily cycle surfaces a draft invoice as an awaiting item (with count)
 *   GD-03  a view-only user sees actionable steps as RESTRICTED with no href
 *   GD-04  setup lists eight steps; the three optional ones do not hold back `ready`, and the
 *          company-details and import steps follow their own permissions
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { AccountingReadinessService } from '../accounting-core/application/accounting-readiness.service';
import { AccountingGuideService } from '../accounting-core/application/accounting-guide.service';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let guide: AccountingGuideService;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);

  // Make the org posting-ready: the fixture omits a VAT_OUTPUT_PAYABLE control account and adds a
  // second ACCOUNTS_PAYABLE account (CTL-TEST) that readiness would flag as ambiguous. Add the VAT
  // role and drop the spare so all seven control roles resolve to exactly one.
  const vat = await prisma.account.create({
    data: { id: `${env.orgId}-VAT-OUT`, organizationId: env.orgId, code: 'VAT-OUT', normalBalance: 'CREDIT', createdBy: env.identity.userId },
  });
  await prisma.accountVersion.create({
    data: {
      accountId: vat.id, versionNumber: 1, name: 'Output VAT', accountClass: 'LIABILITY',
      accountSubtype: 'VAT_OUTPUT_PAYABLE', isPostingAllowed: true,
      effectiveFrom: new Date('2025-01-01'), changedBy: env.identity.userId,
    },
  });
  await prisma.accountVersion.deleteMany({ where: { accountId: env.accounts.ctrlId } });
  await prisma.account.delete({ where: { id: env.accounts.ctrlId } });

  const tenancy = { getClient: () => prisma } as never;
  guide = new AccountingGuideService(tenancy, new AccountingReadinessService(tenancy));
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// ─── GD-01 ────────────────────────────────────────────────────────────────────
it('GD-01: returns four cycles in order; ready with setup DONE', async () => {
  const res = await guide.getGuide(env.identity);

  expect(res.cycles.map((c) => c.key)).toEqual(['setup', 'daily', 'month_end', 'year_end']);
  expect(res.ready).toBe(true);
  expect(res.cycles.find((c) => c.key === 'setup')!.status).toBe('DONE');
  expect(res.currentPeriod).not.toBeNull();
  expect(res.fiscalYear).not.toBeNull();
});

// ─── GD-02 ────────────────────────────────────────────────────────────────────
it('GD-02: daily cycle surfaces a draft invoice as an awaiting item', async () => {
  await prisma.clientInvoice.create({
    data: {
      organizationId: env.orgId, clientId: env.clientId,
      invoiceDate: env.periods.openStart, dueDate: env.periods.openEnd, currencyCode: 'USD',
      subtotal: new Decimal(100), vatAmount: new Decimal(0), totalAmount: new Decimal(100),
      outstandingAmount: new Decimal(100), billingAddressSnapshot: {},
      documentStatus: 'DRAFT', postingStatus: 'NOT_POSTED', createdBy: env.identity.userId,
    },
  });

  const res = await guide.getGuide(env.identity);
  const daily = res.cycles.find((c) => c.key === 'daily')!;
  expect(daily.status).toBe('ATTENTION');
  const invoices = daily.steps.find((s) => s.key === 'invoices')!;
  expect(invoices.status).toBe('ATTENTION');
  expect(invoices.count).toBeGreaterThanOrEqual(1);
});

// ─── GD-03 ────────────────────────────────────────────────────────────────────
it('GD-03: a view-only user sees actionable daily steps as RESTRICTED (no href)', async () => {
  const viewer = { ...env.identity, permissions: ['view:accounting'] };
  const res = await guide.getGuide(viewer);
  const invoices = res.cycles.find((c) => c.key === 'daily')!.steps.find((s) => s.key === 'invoices')!;
  expect(invoices.status).toBe('RESTRICTED');
  expect(invoices.href).toBeNull();
  expect(invoices.count).toBeUndefined();
});

// ─── GD-04 ────────────────────────────────────────────────────────────────────
it('GD-04: setup has eight steps; optional ones do not hold back ready', async () => {
  const res = await guide.getGuide(env.identity);
  const setup = res.cycles.find((c) => c.key === 'setup')!;
  expect(res.organizationName).not.toBe('');
  expect(setup.steps.map((s) => [s.key, s.optional ?? false])).toEqual([
    ['company-details', true],
    ['chart-of-accounts', false],
    ['fiscal-year', false],
    ['bank-accounts', false],
    ['posting-profiles', false],
    ['document-numbering', false],
    ['import-parties', true],
    ['opening-balances', true],
  ]);
  expect(res.ready).toBe(true);
  // The fixture has a supplier and a client but no company tax number and no opening journal.
  expect(setup.steps.find((s) => s.key === 'import-parties')!.status).toBe('DONE');
  expect(setup.steps.find((s) => s.key === 'company-details')!.status).not.toBe('DONE');

  // A payables clerk may import, but company details belong to an administrator.
  const clerk = await guide.getSetupCycle({ ...env.identity, permissions: ['manage:payable'] });
  const byKey = new Map(clerk.cycle.steps.map((s) => [s.key, s]));
  expect(byKey.get('company-details')).toMatchObject({ status: 'RESTRICTED', href: null });
  expect(byKey.get('import-parties')!.status).toBe('DONE');
});
