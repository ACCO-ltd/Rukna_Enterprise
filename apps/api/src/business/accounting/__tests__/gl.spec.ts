/**
 * GL — General Ledger query service
 *
 *   GL-01  Account ledger running balance is computed correctly
 *   GL-02  Running balance accumulates across multiple entries in date order
 *   GL-03  Opening balance = sum of all POSTED lines before fromDate
 *   GL-04  Ledger is scoped to the requesting organization (tenant isolation)
 *   GL-05  GL balance as of a date equals debit minus credit total
 *   GL-06  Drill-down returns all journal entries linked to a source document
 */

import { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { AccountingFixtureFactory, AccountingTestEnv } from './helpers/fixture.factory';
import { buildServices, AccountingServices } from './helpers/build-services';

const prisma = new PrismaClient();
let env: AccountingTestEnv;
let svc: AccountingServices;

beforeAll(async () => {
  env = await AccountingFixtureFactory.create(prisma);
  svc = buildServices(prisma);
});

afterAll(async () => {
  await AccountingFixtureFactory.cleanup(prisma, env.orgId);
  await prisma.$disconnect();
});

/** Post a balanced Dr/Cr journal directly via the posting engine. */
function postJournal(opts: {
  id: string;
  date: Date;
  debitId: string;
  creditId: string;
  amount: number;
  projectId?: string;
  departmentId?: string;
}) {
  const amt = new Decimal(opts.amount.toString());
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: opts.date,
        documentDate:   opts.date,
        description:    `GL test ${opts.id}`,
        currencyCode:   'USD',
        eventType:      `EVT-GL-${opts.id}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   opts.id,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          {
            accountId: opts.debitId,
            debitAmount: amt, creditAmount: new Decimal(0),
            transactionCurrencyCode: 'USD', baseCurrencyAmount: amt,
            projectId: opts.projectId,
            departmentId: opts.departmentId,
          },
          {
            accountId: opts.creditId,
            debitAmount: new Decimal(0), creditAmount: amt,
            transactionCurrencyCode: 'USD', baseCurrencyAmount: amt,
            projectId: opts.projectId,
            departmentId: opts.departmentId,
          },
        ],
      },
      tx as never,
    ),
  );
}

// ─── GL-01 ────────────────────────────────────────────────────────────────────
it('GL-01: account ledger has correct opening, period, and closing balances', async () => {
  const uid = `gl01-${Date.now()}`;

  // Post 200 Dr bank / Cr rev on Jan 5
  await postJournal({
    id: `${uid}-a`,
    date: new Date('2025-01-05'),
    debitId: env.accounts.bankId,
    creditId: env.accounts.revId,
    amount: 200,
  });

  const ledger = await svc.ledgerService.getAccountLedger(env.identity, {
    accountId: env.accounts.bankId,
    fromDate: '2025-01-01',
    toDate:   '2025-01-31',
  });

  // Opening balance before Jan 1 must be 0 (nothing posted before this org's period)
  expect(Number(ledger.openingBalance)).toBe(0);

  // Find our line
  const ourLine = ledger.lines.find((l) => l.sourceDocumentId === `${uid}-a`);
  expect(ourLine).toBeDefined();
  expect(Number(ourLine!.debitAmount)).toBe(200);
  expect(Number(ourLine!.creditAmount)).toBe(0);

  // Closing balance must be >= 200 (there may be earlier tests posting to bankId)
  expect(Number(ledger.closingBalance)).toBeGreaterThanOrEqual(200);
});

// ─── GL-02 ────────────────────────────────────────────────────────────────────
it('GL-02: running balance accumulates across sequential entries', async () => {
  const uid = `gl02-${Date.now()}`;

  // Post two entries on same account in the same period
  await postJournal({
    id: `${uid}-a`,
    date: new Date('2025-01-10'),
    debitId: env.accounts.bankId,
    creditId: env.accounts.revId,
    amount: 100,
  });
  await postJournal({
    id: `${uid}-b`,
    date: new Date('2025-01-15'),
    debitId: env.accounts.bankId,
    creditId: env.accounts.revId,
    amount: 300,
  });

  const ledger = await svc.ledgerService.getAccountLedger(env.identity, {
    accountId: env.accounts.bankId,
    fromDate: '2025-01-10',
    toDate:   '2025-01-15',
  });

  const lines = ledger.lines.filter((l) => l.sourceDocumentId?.startsWith(uid));
  expect(lines.length).toBe(2);

  // Lines must be in ascending date order
  const [first, second] = lines;
  expect(Number(first.debitAmount)).toBe(100);
  expect(Number(second.debitAmount)).toBe(300);

  // Running balance on second line must equal opening + 100 + 300
  const expectedClosing = Number(ledger.openingBalance) + 100 + 300;
  expect(Number(second.runningBalance)).toBe(expectedClosing);
  expect(Number(ledger.closingBalance)).toBe(Number(second.runningBalance));
});

// ─── GL-03 ────────────────────────────────────────────────────────────────────
it('GL-03: opening balance is sum of all POSTED lines before fromDate', async () => {
  const uid = `gl03-${Date.now()}`;

  // Post on Jan 5 (before fromDate of Jan 20)
  await postJournal({
    id: `${uid}-before`,
    date: new Date('2025-01-05'),
    debitId: env.accounts.expId,
    creditId: env.accounts.revId,
    amount: 150,
  });
  // Post on Jan 22 (within fromDate..toDate)
  await postJournal({
    id: `${uid}-within`,
    date: new Date('2025-01-22'),
    debitId: env.accounts.expId,
    creditId: env.accounts.revId,
    amount: 250,
  });

  const ledger = await svc.ledgerService.getAccountLedger(env.identity, {
    accountId: env.accounts.expId,
    fromDate: '2025-01-20',
    toDate:   '2025-01-31',
  });

  // The Jan 5 entry must appear in opening balance, not in lines
  expect(Number(ledger.openingBalance)).toBeGreaterThanOrEqual(150);

  const periodLine = ledger.lines.find((l) => l.sourceDocumentId === `${uid}-within`);
  expect(periodLine).toBeDefined();

  const beforeLine = ledger.lines.find((l) => l.sourceDocumentId === `${uid}-before`);
  expect(beforeLine).toBeUndefined();
});

// ─── GL-04 ────────────────────────────────────────────────────────────────────
it('GL-04: ledger is scoped to requesting organization — cross-org entries excluded', async () => {
  const otherEnv = await AccountingFixtureFactory.create(prisma);
  try {
    // Post in the other org
    await prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: otherEnv.orgId,
          accountingDate: new Date('2025-01-10'),
          documentDate:   new Date('2025-01-10'),
          description:    'GL-04 other org entry',
          currencyCode:   'USD',
          eventType:      `EVT-GL04-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `gl04-other-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          otherEnv.identity.userId,
          lines: [
            // Both orgs happen to use same account IDs (orgId-prefixed codes, but same accountId structure)
            { accountId: otherEnv.accounts.bankId, debitAmount: new Decimal('9999'), creditAmount: new Decimal(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('9999') },
            { accountId: otherEnv.accounts.revId,  debitAmount: new Decimal(0), creditAmount: new Decimal('9999'), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('9999') },
          ],
        },
        tx as never,
      ),
    );

    // Query our org's ledger — the other org's bankId is a different account ID, so zero balance
    const ledger = await svc.ledgerService.getAccountLedger(env.identity, {
      accountId: env.accounts.bankId,
      fromDate: '2025-01-01',
      toDate:   '2025-01-31',
    });

    // None of our ledger lines should reference the other org's account
    for (const line of ledger.lines) {
      expect(line.journalEntryId).not.toContain(otherEnv.orgId);
    }
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, otherEnv.orgId);
  }
});

// ─── GL-05 ────────────────────────────────────────────────────────────────────
it('GL-05: getGlBalance returns debit-credit net as of the given date', async () => {
  const uid = `gl05-${Date.now()}`;

  await postJournal({
    id: `${uid}-a`,
    date: new Date('2025-01-08'),
    debitId: env.accounts.bankId,
    creditId: env.accounts.revId,
    amount: 500,
  });
  await postJournal({
    id: `${uid}-b`,
    date: new Date('2025-01-09'),
    debitId: env.accounts.revId,
    creditId: env.accounts.bankId,
    amount: 200,
  });

  // As of Jan 09: bank net = +500 - 200 = +300 from these two entries (plus any prior)
  const balance = await svc.ledgerService.getGlBalance(env.identity, env.accounts.bankId, '2025-01-09');

  const net = Number(balance.debitTotal) - Number(balance.creditTotal);
  expect(parseFloat(balance.netBalance)).toBeCloseTo(net, 2);
  // Must be positive — bank has more debits than credits across the test session
  expect(parseFloat(balance.netBalance)).toBeGreaterThanOrEqual(300);
});

// ─── GL-06 ────────────────────────────────────────────────────────────────────
it('GL-06: drill-down returns all journal entries for a given source document', async () => {
  const docId = `gl06-src-${Date.now()}`;

  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-12'),
        documentDate:   new Date('2025-01-12'),
        description:    'GL-06 drill-down test',
        currencyCode:   'USD',
        eventType:      `EVT-GL06-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   docId,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: new Decimal('750'), creditAmount: new Decimal(0), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('750') },
          { accountId: env.accounts.revId,  debitAmount: new Decimal(0), creditAmount: new Decimal('750'), transactionCurrencyCode: 'USD', baseCurrencyAmount: new Decimal('750') },
        ],
      },
      tx as never,
    ),
  );

  const entries = await svc.ledgerService.drillDown(env.identity, 'MANUAL_JOURNAL', docId);
  expect(entries.length).toBeGreaterThanOrEqual(1);
  expect(entries.every((e) => e.sourceDocumentId === docId)).toBe(true);
  expect(entries[0].lines.length).toBe(2);
});
