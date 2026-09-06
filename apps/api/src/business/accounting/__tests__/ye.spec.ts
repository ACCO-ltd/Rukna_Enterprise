/**
 * YE — Year-end close against the REAL posting engine.
 *
 *   YE-05  closeYear succeeds with period 12 LOCKED, and the closing journal posts
 *   YE-06  the closing journal zeroes the P&L accounts it closed
 *   YE-07  a rerun after a half-finished close resumes instead of dead-ending
 *
 * The existing `year-end-close.service.spec.ts` mocks the posting port outright, so
 * `PeriodValidator` never ran against a real close. It rejected everything except
 * CLOSING_ADJUSTMENT in a LOCKED period — and `closeYear` *requires* period 12 to be
 * LOCKED — which meant year-end close could never post. These tests exercise the
 * whole path so that can never be true again silently.
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

/** A fiscal year with twelve periods, in a year the shared fixture does not occupy. */
async function makeFiscalYear(year: number) {
  const fy = await prisma.fiscalYear.create({
    data: {
      organizationId: env.orgId,
      name: `FY${year}-${Math.random().toString(36).slice(2, 8)}`,
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31)),
      retainedEarningsAccountId: env.accounts.reId,
      createdBy: env.identity.userId,
      status: 'OPEN',
      periods: {
        create: Array.from({ length: 12 }, (_, i) => ({
          organizationId: env.orgId,
          periodNumber: i + 1,
          name: `P${i + 1} ${year}`,
          startDate: new Date(Date.UTC(year, i, 1)),
          endDate: new Date(Date.UTC(year, i + 1, 0)),
          periodType: 'OPERATING' as const,
          // Period 12 stays OPEN so the test can post P&L activity into it, then it is
          // locked below — the state closeYear demands.
          status: 'OPEN' as const,
        })),
      },
    },
    include: { periods: { orderBy: { periodNumber: 'asc' } } },
  });
  return fy;
}

/** Post one revenue/expense pair into the given date, through the real engine. */
async function postPl(
  sourceId: string,
  accountingDate: Date,
  revenue: string,
  expense: string,
) {
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate,
        documentDate: accountingDate,
        description: 'YE fixture activity',
        currencyCode: 'USD',
        eventType: 'EVT-YE-FIXTURE',
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId: sourceId,
        journalCategory: 'GENERAL',
        entryPurpose: 'NORMAL',
        postingOrigin: 'MANUAL',
        createdBy: env.identity.userId,
        lines: [
          {
            accountId: env.accounts.expId,
            debitAmount: new Decimal(expense),
            creditAmount: new Decimal(0),
          },
          {
            accountId: env.accounts.revId,
            debitAmount: new Decimal(0),
            creditAmount: new Decimal(revenue),
          },
          {
            accountId: env.accounts.bankId,
            debitAmount: new Decimal(revenue).minus(new Decimal(expense)),
            creditAmount: new Decimal(0),
          },
        ],
      },
      tx as never,
    ),
  );
}

/** Lock period 12 and close 1–11 — the shape closeYear insists on. */
async function readyForClose(fyId: string) {
  const periods = await prisma.accountingPeriod.findMany({
    where: { fiscalYearId: fyId },
    orderBy: { periodNumber: 'asc' },
  });
  for (const p of periods) {
    await prisma.accountingPeriod.update({
      where: { id: p.id },
      data: { status: p.periodNumber === 12 ? 'LOCKED' : 'CLOSED' },
    });
  }
  return periods;
}

/** Debit-less-credit balance of an account over a fiscal year's periods. */
async function plBalance(accountId: string, periodIds: string[]) {
  const agg = await prisma.journalLine.aggregate({
    where: {
      accountId,
      entry: { organizationId: env.orgId, status: 'POSTED', accountingPeriodId: { in: periodIds } },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });
  return new Decimal(agg._sum.debitAmount?.toString() ?? '0').minus(
    new Decimal(agg._sum.creditAmount?.toString() ?? '0'),
  );
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

// ─── YE-05 ────────────────────────────────────────────────────────────────────
it('YE-05: closeYear posts the closing journal into the LOCKED period 12', async () => {
  const fy = await makeFiscalYear(2031);
  await postPl(`ye05-${fy.id}`, new Date(Date.UTC(2031, 11, 15)), '9000.00', '4000.00');
  const periods = await readyForClose(fy.id);

  const result = await svc.yearEndCloseService.closeYear(env.identity, fy.id);

  expect(result.closingJournalId).toBeTruthy();
  // Revenue 9000 less expense 4000 — a profit, so retained earnings is credited.
  expect(result.netIncome).toBe('5000.00');

  const closing = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: result.closingJournalId },
    include: { lines: true },
  });
  expect(closing.status).toBe('POSTED');
  expect(closing.entryPurpose).toBe('CLOSING');
  expect(closing.journalCategory).toBe('YEAR_END_CLOSE');
  // Accounting-date rule: the closing entry belongs to the period it closes.
  expect(closing.accountingPeriodId).toBe(periods[11]!.id);

  const re = closing.lines.find((l) => l.accountId === env.accounts.reId);
  expect(Number(re?.creditAmount ?? 0)).toBeCloseTo(5000, 2);

  const fyAfter = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy.id } });
  expect(fyAfter.status).toBe('CLOSED');
  const p12 = await prisma.accountingPeriod.findUniqueOrThrow({ where: { id: periods[11]!.id } });
  expect(p12.status).toBe('CLOSED');
});

// ─── YE-06 ────────────────────────────────────────────────────────────────────
it('YE-06: the closing journal leaves every P&L account it closed at zero', async () => {
  const fy = await makeFiscalYear(2032);
  await postPl(`ye06-${fy.id}`, new Date(Date.UTC(2032, 5, 10)), '7500.00', '2500.00');
  const periods = await readyForClose(fy.id);
  const periodIds = periods.map((p) => p.id);

  await svc.yearEndCloseService.closeYear(env.identity, fy.id);

  // Including the CLOSING entry, revenue and expense must net to nothing.
  expect((await plBalance(env.accounts.revId, periodIds)).toFixed(2)).toBe('0.00');
  expect((await plBalance(env.accounts.expId, periodIds)).toFixed(2)).toBe('0.00');
  // The result landed in retained earnings instead: profit ⇒ credit ⇒ negative debit-balance.
  expect((await plBalance(env.accounts.reId, periodIds)).toFixed(2)).toBe('-5000.00');
});

// ─── YE-07 ────────────────────────────────────────────────────────────────────
it('YE-07: a rerun after a half-finished close resumes rather than dead-ending', async () => {
  const fy = await makeFiscalYear(2033);
  await postPl(`ye07-${fy.id}`, new Date(Date.UTC(2033, 2, 3)), '4000.00', '1000.00');
  await readyForClose(fy.id);

  const first = await svc.yearEndCloseService.closeYear(env.identity, fy.id);

  // Simulate the crash the old guard made unrecoverable: the closing journal is
  // posted, but the fiscal year never reached CLOSED.
  await prisma.fiscalYear.update({ where: { id: fy.id }, data: { status: 'OPEN', closedAt: null } });
  await prisma.accountingPeriod.updateMany({
    where: { fiscalYearId: fy.id, periodNumber: 12 },
    data: { status: 'LOCKED' },
  });

  const second = await svc.yearEndCloseService.closeYear(env.identity, fy.id);

  // Same journal — the rerun must not post a second closing entry.
  expect(second.closingJournalId).toBe(first.closingJournalId);
  const closings = await prisma.journalEntry.count({
    where: { organizationId: env.orgId, sourceDocumentType: 'YEAR_END_CLOSE', sourceDocumentId: fy.id },
  });
  expect(closings).toBe(1);

  const fyAfter = await prisma.fiscalYear.findUniqueOrThrow({ where: { id: fy.id } });
  expect(fyAfter.status).toBe('CLOSED');
});
