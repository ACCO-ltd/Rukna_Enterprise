/**
 * PLG — Project ledger.
 *
 *   PLG-01  returns only lines carrying this project
 *   PLG-02  class totals cover the whole filtered set, not the current page
 *   PLG-03  the date filter bounds on accountingDate
 *   PLG-04  account code and name are the snapshots taken at post time
 *   PLG-05  the page size is capped server-side
 *
 * The drill-down beneath every Finance figure. Runs against the real DB through the real
 * posting engine, because what matters is that the rows it returns are the rows that posted.
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';
import { ProjectLedgerService } from '../general-ledger/application/project-ledger.service.js';
import type { TenancyService } from '../../../platform/tenancy/tenancy.service.js';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;
let ledger: ProjectLedgerService;

const PROJECT = 'plg-project-1';
const OTHER_PROJECT = 'plg-project-2';

/** Revenue credit + cost debit for a project, posted through the real engine. */
async function post(
  sourceId: string,
  projectId: string,
  accountingDate: Date,
  revenue: string,
  cost: string,
) {
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate,
        documentDate: accountingDate,
        description: `PLG ${sourceId}`,
        currencyCode: 'USD',
        eventType: `EVT-PLG-${sourceId}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId: sourceId,
        journalCategory: 'GENERAL',
        entryPurpose: 'NORMAL',
        postingOrigin: 'MANUAL',
        createdBy: env.identity.userId,
        lines: [
          {
            accountId: env.accounts.expId,
            debitAmount: new Decimal(cost),
            creditAmount: new Decimal(0),
            projectId,
          },
          {
            accountId: env.accounts.revId,
            debitAmount: new Decimal(0),
            creditAmount: new Decimal(revenue),
            projectId,
          },
          {
            accountId: env.accounts.bankId,
            debitAmount: new Decimal(revenue).minus(new Decimal(cost)),
            creditAmount: new Decimal(0),
          },
        ],
      },
      tx as never,
    ),
  );
}

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
  ledger = new ProjectLedgerService({ getClient: () => prisma } as unknown as TenancyService);

  await post('plg-a', PROJECT, env.periods.openStart, '1000', '400');
  await post('plg-b', PROJECT, env.periods.openEnd, '500', '200');
  // A different project, to prove the filter is real.
  await post('plg-c', OTHER_PROJECT, env.periods.openStart, '9999', '8888');
}, 40_000);

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
}, 30_000);

it('PLG-01: returns only the lines carrying this project', async () => {
  const result = await ledger.getForProject(env.identity, PROJECT, {});

  expect(result.total).toBe(4); // two entries × (revenue + cost); the bank line carries no project
  expect(result.lines.every((l) => l.debitAmount !== undefined)).toBe(true);
  // Nothing from the other project leaked in.
  const amounts = result.lines.map((l) => `${l.debitAmount}/${l.creditAmount}`);
  expect(amounts.join(' ')).not.toMatch(/9999|8888/);
});

it('PLG-02: class totals cover the whole set even when a page is smaller', async () => {
  const page = await ledger.getForProject(env.identity, PROJECT, { limit: 1 });

  expect(page.lines).toHaveLength(1);
  expect(page.total).toBe(4);
  // A total that changed when you turned the page would not be a total.
  expect(page.totalRevenue).toBe('1500.00');
  expect(page.totalCost).toBe('600.00');
});

it('PLG-03: the date filter bounds on the accounting date', async () => {
  const result = await ledger.getForProject(env.identity, PROJECT, {
    fromDate: env.periods.openEnd.toISOString().slice(0, 10),
    toDate: env.periods.openEnd.toISOString().slice(0, 10),
  });

  expect(result.total).toBe(2);
  expect(result.totalRevenue).toBe('500.00');
  expect(result.totalCost).toBe('200.00');
});

it('PLG-04: account code and name are the snapshots taken at post time', async () => {
  const result = await ledger.getForProject(env.identity, PROJECT, {});
  const costLine = result.lines.find((l) => l.accountId === env.accounts.expId);

  expect(costLine).toBeDefined();
  expect(costLine!.accountCode).toBe(env.accounts.expCode);
  // Not blank: a ledger that cannot name its accounts is not an audit trail.
  expect(costLine!.accountName).toBeTruthy();
});

it('PLG-05: the page size is capped server-side', async () => {
  const result = await ledger.getForProject(env.identity, PROJECT, { limit: 10_000 });

  expect(result.limit).toBe(500);
});
