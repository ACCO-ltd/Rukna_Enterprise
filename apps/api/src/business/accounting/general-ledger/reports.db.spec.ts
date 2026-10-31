/**
 * R — the financial statements read true (live DB).
 *
 *   R-01  the balance sheet balances when the date falls outside every fiscal year: profit not yet
 *         closed shows as "earlier years not yet closed", this year's as net income
 *   R-02  the reports refuse impossible dates and a range that runs backwards
 *   R-03  the monthly comparison gives each account's figure per month; an unknown year is a 404
 */

import { PrismaClient } from '@prisma/client';

import { AccountingFixtureFactory, type AccountingTestEnv } from '../__tests__/helpers/fixture.factory';
import { buildServices, type AccountingServices } from '../__tests__/helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  // A sale of 100 against an expense account in January 2025, through the manual journal flow.
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-10', description: 'R-01 sale', currencyCode: 'USD',
    lines: [{ accountId: env.accounts.expId, debitAmount: 100 }, { accountId: env.accounts.revId, creditAmount: 100 }],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  await svc.manualJournalService.post(env.identity, draft.id);
}, 90_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

const code = (p: Promise<unknown>) => p.then(() => 'ok', (e: { response?: { errorCode?: string } }) => e.response?.errorCode);

it('R-01: balances inside and outside the fiscal year, with earnings split by year', async () => {
  const inYear = await svc.balanceSheetService.generate(env.identity, { asOfDate: '2025-01-31' });
  expect(inYear.balanced).toBe(true);
  expect(inYear.equity.lines.find((l) => l.accountId === 'PRIOR_YEAR_EARNINGS')).toBeUndefined();

  // FY2025 is never closed and no fiscal year covers 2027: the year's profit is still on the P&L
  // accounts, so it shows as earlier years not yet closed and the sheet still balances.
  const later = await svc.balanceSheetService.generate(env.identity, { asOfDate: '2027-06-30' });
  expect(later.balanced).toBe(true);
  expect(later.equity.lines.find((l) => l.accountId === 'CURRENT_YEAR_EARNINGS')).toBeUndefined();
  const thisYear = inYear.equity.lines.find((l) => l.accountId === 'CURRENT_YEAR_EARNINGS')?.balance ?? '0.00';
  expect(later.equity.lines.find((l) => l.accountId === 'PRIOR_YEAR_EARNINGS')?.balance ?? '0.00').toBe(thisYear);
});

it('R-02: impossible dates and backwards ranges are refused', async () => {
  expect(await code(svc.balanceSheetService.generate(env.identity, { asOfDate: '2025-02-30' }))).toBe('DATE_INVALID');
  expect(await code(svc.balanceSheetService.generate(env.identity, { asOfDate: '2025-01-31', comparativeDate: '2024-13-01' }))).toBe('DATE_INVALID');
  expect(await code(svc.trialBalanceService.generate(env.identity, { asOfDate: '2025-04-31' }))).toBe('DATE_INVALID');
  expect(await code(svc.plReportService.generate(env.identity, { fromDate: '2025-02-31', toDate: '2025-03-31' }))).toBe('DATE_INVALID');
  expect(await code(svc.plReportService.generate(env.identity, { fromDate: '2025-03-01', toDate: '2025-01-01' }))).toBe('DATE_RANGE_INVALID');
});

it('R-03: the monthly comparison lists each account per month; an unknown year is a 404', async () => {
  const monthly = await svc.plReportService.generateMonthlyComparison(env.identity, env.fiscalYearId, {});
  const january = monthly.columns.find((c) => c.periodNumber === 1)!;
  expect(january.lines.find((l) => l.accountId === env.accounts.revId)?.amount).toBe(january.revenue);
  expect(january.lines.find((l) => l.accountId === env.accounts.expId)?.amount).toBeDefined();
  await expect(svc.plReportService.generateMonthlyComparison(env.identity, 'no-such-year', {})).rejects.toMatchObject({ status: 404 });
});

it('R-04: the comparison column lists accounts that held money then and nothing now', async () => {
  // Move the expense out to another account on 25 January: at the end of January the expense
  // account is empty, while on 20 January it still held the 100.
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-25', description: 'R-04 move', currencyCode: 'USD',
    lines: [{ accountId: env.accounts.revId, debitAmount: 100 }, { accountId: env.accounts.expId, creditAmount: 100 }],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  await svc.manualJournalService.post(env.identity, draft.id);
  const bs = await svc.balanceSheetService.generate(env.identity, { asOfDate: '2025-01-31', comparativeDate: '2025-01-20' });
  const sum = (lines: { comparativeBalance?: string }[]) => lines.reduce((t, l) => t + Number(l.comparativeBalance ?? 0), 0).toFixed(2);
  expect(sum(bs.assets.lines)).toBe(Number(bs.assets.comparativeTotal).toFixed(2));
  expect(sum(bs.equity.lines)).toBe(Number(bs.equity.comparativeTotal).toFixed(2));
  expect(bs.comparativeBalanced).toBe(true);
});
