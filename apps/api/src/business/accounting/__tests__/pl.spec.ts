/**
 * PL — Profit & Loss and Balance Sheet
 *
 *   PL-01  P&L net income = revenue - CoS - expenses
 *   PL-02  P&L excludes journal entries with entryPurpose = CLOSING
 *   PL-03  P&L by project filters to lines tagged with that projectId
 *   PL-04  P&L by department filters to lines tagged with that departmentId
 *   PL-05  Monthly P&L comparison returns one column per accounting period
 *   BS-01  Balance Sheet: Assets = Liabilities + Equity (within $0.01)
 *   BS-02  Balance Sheet includes Current Year Earnings when FY is not closed
 *   BS-03  Balance Sheet balanced flag is true
 *   BS-04  Balance Sheet is org-scoped (cross-org entries excluded)
 *   PL-06  P&L net income agrees with Current Year Earnings in Balance Sheet
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

// Known amounts posted in beforeAll — used in assertions
const SEED_REVENUE  = 2000; // Cr rev
const SEED_EXPENSE  = 800;  // Dr exp
const SEED_NET      = SEED_REVENUE - SEED_EXPENSE; // 1200
const SEED_PROJ_REV = 600;  // tagged to projectA
const SEED_DEPT_REV = 400;  // tagged to deptA

let projectAId: string;
let deptAId:    string;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);

  // Use a project ID from the fixture (it already exists in DB)
  // The fixture creates a project with a known ID pattern — we use a synthetic dimension
  // value since JournalLine.projectId is just a FK-free dimension string.
  // For testing we use the fixture's own project (orgId-based).
  projectAId = `proj-a-${env.orgId}`;
  deptAId    = `dept-a-${env.orgId}`;

  const d = (n: number) => new Decimal(n.toString());

  // Seed: Dr bank / Cr rev 2000 (no project tag) — Jan 2025
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-10'),
        documentDate:   new Date('2025-01-10'),
        description:    'PL seed revenue',
        currencyCode:   'USD',
        eventType:      `EVT-PL-REV-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   `pl-rev-${Date.now()}`,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: d(SEED_REVENUE), creditAmount: d(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_REVENUE) },
          { accountId: env.accounts.revId,  debitAmount: d(0), creditAmount: d(SEED_REVENUE), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_REVENUE) },
        ],
      },
      tx as never,
    ),
  );

  // Seed: Dr exp / Cr bank 800 — Jan 2025
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-12'),
        documentDate:   new Date('2025-01-12'),
        description:    'PL seed expense',
        currencyCode:   'USD',
        eventType:      `EVT-PL-EXP-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   `pl-exp-${Date.now()}`,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.expId,  debitAmount: d(SEED_EXPENSE), creditAmount: d(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_EXPENSE) },
          { accountId: env.accounts.bankId, debitAmount: d(0), creditAmount: d(SEED_EXPENSE), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_EXPENSE) },
        ],
      },
      tx as never,
    ),
  );

  // Seed: CLOSING entry — Dr exp / Cr rev 500 — Jan 2025
  // Must be EXCLUDED from P&L
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-31'),
        documentDate:   new Date('2025-01-31'),
        description:    'PL seed CLOSING — must be excluded',
        currencyCode:   'USD',
        eventType:      `EVT-PL-CLOSE-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   `pl-closing-${Date.now()}`,
        journalCategory:    'GENERAL',
        entryPurpose:       'CLOSING',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.expId, debitAmount: d(500), creditAmount: d(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(500) },
          { accountId: env.accounts.revId, debitAmount: d(0),   creditAmount: d(500), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(500) },
        ],
      },
      tx as never,
    ),
  );

  // Seed: Dr bank / Cr rev 600 TAGGED with projectAId
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-14'),
        documentDate:   new Date('2025-01-14'),
        description:    'PL seed project revenue',
        currencyCode:   'USD',
        eventType:      `EVT-PL-PROJ-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   `pl-proj-${Date.now()}`,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: d(SEED_PROJ_REV), creditAmount: d(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_PROJ_REV), projectId: projectAId },
          { accountId: env.accounts.revId,  debitAmount: d(0), creditAmount: d(SEED_PROJ_REV), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_PROJ_REV), projectId: projectAId },
        ],
      },
      tx as never,
    ),
  );

  // Seed: Dr bank / Cr rev 400 TAGGED with deptAId
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-14'),
        documentDate:   new Date('2025-01-14'),
        description:    'PL seed dept revenue',
        currencyCode:   'USD',
        eventType:      `EVT-PL-DEPT-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   `pl-dept-${Date.now()}`,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: d(SEED_DEPT_REV), creditAmount: d(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_DEPT_REV), departmentId: deptAId },
          { accountId: env.accounts.revId,  debitAmount: d(0), creditAmount: d(SEED_DEPT_REV), transactionCurrencyCode: 'USD', baseCurrencyAmount: d(SEED_DEPT_REV), departmentId: deptAId },
        ],
      },
      tx as never,
    ),
  );
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// ─── PL-01 ────────────────────────────────────────────────────────────────────
it('PL-01: net income = revenue − expenses (CLOSING entries excluded by seed design)', async () => {
  const report = await svc.plReportService.generate(env.identity, {
    fromDate: '2025-01-01',
    toDate:   '2025-01-31',
  });

  // Our seed posts 2000 rev + 600 proj rev + 400 dept rev = 3000 total revenue
  // Expenses: 800 (CLOSING 500 excluded)
  // Net = 3000 - 800 = 2200
  // (There may be residual entries from other tests using the same org, but
  //  we specifically ensure the CLOSING entry does NOT appear — see PL-02.)
  const revenue  = Number(report.revenue.total);
  const expenses = Number(report.expenses.total);
  const netIncome = Number(report.netIncome);
  const grossProfit = Number(report.grossProfit);

  expect(revenue).toBeGreaterThanOrEqual(SEED_REVENUE);
  expect(expenses).toBeGreaterThanOrEqual(SEED_EXPENSE);
  expect(grossProfit).toBeCloseTo(revenue - Number(report.costOfSales.total), 2);
  expect(netIncome).toBeCloseTo(grossProfit - expenses, 2);
});

// ─── PL-02 ────────────────────────────────────────────────────────────────────
it('PL-02: P&L excludes entries with entryPurpose = CLOSING', async () => {
  // Query over just Jan 31 (where the CLOSING entry was posted)
  const reportFull   = await svc.plReportService.generate(env.identity, { fromDate: '2025-01-01', toDate: '2025-01-31' });
  const reportNoClos = await svc.plReportService.generate(env.identity, { fromDate: '2025-01-01', toDate: '2025-01-30' });

  // The CLOSING entry (Dr exp 500 / Cr rev 500) on Jan 31 should NOT affect the report.
  // Both reports should have the same revenue — CLOSING doesn't add to revenue.
  // CLOSING entries are excluded from P&L regardless.
  expect(Number(reportFull.revenue.total)).toBe(Number(reportNoClos.revenue.total));
  expect(Number(reportFull.expenses.total)).toBe(Number(reportNoClos.expenses.total));
});

// ─── PL-03 ────────────────────────────────────────────────────────────────────
it('PL-03: P&L filtered by projectId returns only project-tagged lines', async () => {
  const report = await svc.plReportService.generate(env.identity, {
    fromDate:  '2025-01-01',
    toDate:    '2025-01-31',
    projectId: projectAId,
  });

  // Only the 600 project-tagged revenue entry is in scope
  expect(Number(report.revenue.total)).toBe(SEED_PROJ_REV);
  // No expenses were tagged to projectAId
  expect(Number(report.expenses.total)).toBe(0);
  expect(Number(report.netIncome)).toBe(SEED_PROJ_REV);
});

// ─── PL-04 ────────────────────────────────────────────────────────────────────
it('PL-04: P&L filtered by departmentId returns only department-tagged lines', async () => {
  const report = await svc.plReportService.generate(env.identity, {
    fromDate:     '2025-01-01',
    toDate:       '2025-01-31',
    departmentId: deptAId,
  });

  expect(Number(report.revenue.total)).toBe(SEED_DEPT_REV);
  expect(Number(report.expenses.total)).toBe(0);
  expect(Number(report.netIncome)).toBe(SEED_DEPT_REV);
});

// ─── PL-05 ────────────────────────────────────────────────────────────────────
it('PL-05: monthly P&L comparison returns one column per accounting period in the FY', async () => {
  const comparison = await svc.plReportService.generateMonthlyComparison(
    env.identity,
    env.fiscalYearId,
    {},
  );

  // The fixture has 3 periods (Jan, Feb, Mar)
  expect(comparison).not.toBeNull();
  expect(comparison!.columns.length).toBe(3);

  // Period numbers should be sequential
  const periodNumbers = comparison!.columns.map((c) => c.periodNumber);
  expect(periodNumbers).toEqual([1, 2, 3]);

  // January must include the seed revenue (OPEN period)
  const jan = comparison!.columns.find((c) => c.periodNumber === 1);
  expect(Number(jan!.revenue)).toBeGreaterThanOrEqual(SEED_REVENUE);

  // Feb and Mar should have 0 revenue (no entries seeded there in this env)
  const feb = comparison!.columns.find((c) => c.periodNumber === 2);
  const mar = comparison!.columns.find((c) => c.periodNumber === 3);
  expect(Number(feb!.revenue)).toBe(0);
  expect(Number(mar!.revenue)).toBe(0);
});

// ─── BS-01 ────────────────────────────────────────────────────────────────────
it('BS-01: balance sheet is balanced — Assets = Liabilities + Equity', async () => {
  const bs = await svc.balanceSheetService.generate(env.identity, {
    asOfDate: '2025-01-31',
  });

  const assets   = Number(bs.assets.total);
  const liabEquity = Number(bs.totalLiabilitiesAndEquity);

  expect(bs.balanced).toBe(true);
  expect(Math.abs(assets - liabEquity)).toBeLessThanOrEqual(0.01);
});

// ─── BS-02 ────────────────────────────────────────────────────────────────────
it('BS-02: balance sheet includes Current Year Earnings when FY is not closed', async () => {
  const bs = await svc.balanceSheetService.generate(env.identity, {
    asOfDate: '2025-01-31',
  });

  const cyeLine = bs.equity.lines.find((l) => l.accountId === 'CURRENT_YEAR_EARNINGS');
  expect(cyeLine).toBeDefined();

  // CYE must equal the P&L net income for the same period
  const pl = await svc.plReportService.generate(env.identity, {
    fromDate: '2025-01-01',
    toDate:   '2025-01-31',
  });

  expect(Number(cyeLine!.balance)).toBeCloseTo(Number(pl.netIncome), 2);
});

// ─── BS-03 ────────────────────────────────────────────────────────────────────
it('BS-03: balance sheet balanced flag is true for this org', async () => {
  const bs = await svc.balanceSheetService.generate(env.identity, {
    asOfDate: '2025-01-31',
  });
  expect(bs.balanced).toBe(true);
});

// ─── BS-04 ────────────────────────────────────────────────────────────────────
it('BS-04: balance sheet is org-scoped — other org entries do not appear', async () => {
  const otherEnv = await AccountingFixtureFactory.create(prisma);
  try {
    // Post 99999 in the other org
    await prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: otherEnv.orgId,
          accountingDate: new Date('2025-01-20'),
          documentDate:   new Date('2025-01-20'),
          description:    'BS-04 other org',
          currencyCode:   'USD',
          eventType:      `EVT-BS04-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `bs04-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          otherEnv.identity.userId,
          lines: [
            { accountId: otherEnv.accounts.bankId, debitAmount: new Decimal('99999'), creditAmount: new Decimal(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('99999') },
            { accountId: otherEnv.accounts.revId,  debitAmount: new Decimal(0),      creditAmount: new Decimal('99999'), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('99999') },
          ],
        },
        tx as never,
      ),
    );

    const bs = await svc.balanceSheetService.generate(env.identity, { asOfDate: '2025-01-31' });

    // Our balance sheet must not include the 99999 asset from the other org
    expect(Number(bs.assets.total)).toBeLessThan(99999);
    // All account IDs must belong to our org
    const allIds = [
      ...bs.assets.lines.map((l) => l.accountId),
      ...bs.liabilities.lines.map((l) => l.accountId),
      ...bs.equity.lines.filter((l) => l.accountId !== 'CURRENT_YEAR_EARNINGS').map((l) => l.accountId),
    ];
    for (const id of allIds) {
      expect(id).toContain(env.orgId);
    }
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, otherEnv.orgId);
  }
});

// ─── PL-06 ────────────────────────────────────────────────────────────────────
it('PL-06: P&L net income matches Current Year Earnings in Balance Sheet', async () => {
  const pl = await svc.plReportService.generate(env.identity, {
    fromDate: '2025-01-01',
    toDate:   '2025-01-31',
  });
  const bs = await svc.balanceSheetService.generate(env.identity, {
    asOfDate: '2025-01-31',
  });

  const cyeLine = bs.equity.lines.find((l) => l.accountId === 'CURRENT_YEAR_EARNINGS');
  expect(cyeLine).toBeDefined();
  expect(Number(cyeLine!.balance)).toBeCloseTo(Number(pl.netIncome), 2);
});
