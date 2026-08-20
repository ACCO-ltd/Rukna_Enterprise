/**
 * TB — Trial Balance
 *
 *   TB-01  Trial balance is balanced (total closing debit = total closing credit) after balanced postings
 *   TB-02  Trial balance includes all accounts with activity in the period
 *   TB-03  Trial balance zero-balance filter: excluded by default, included when flag is set
 *   TB-04  Trial balance uses PeriodAccountBalance snapshot for a CLOSED period
 *   TB-05  Trial balance is organization-scoped (cross-org entries excluded)
 *   TB-06  Trial balance opening + movement = closing for each account
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

  // Seed one balanced journal: Dr bank 1000 / Cr rev 1000 — Jan 2025 (OPEN period)
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: new Date('2025-01-15'),
        documentDate:   new Date('2025-01-15'),
        description:    'TB seed — balanced',
        currencyCode:   'USD',
        eventType:      'EVT-TB-SEED',
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   `tb-seed-${Date.now()}`,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: new Decimal('1000'), creditAmount: new Decimal(0) },
          { accountId: env.accounts.revId,  debitAmount: new Decimal(0),    creditAmount: new Decimal('1000') },
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

// ─── TB-01 ────────────────────────────────────────────────────────────────────
it('TB-01: trial balance closing totals debit = credit (balanced flag = true)', async () => {
  const result = await svc.trialBalanceService.generate(env.identity, {
    asOfDate: '2025-01-31',
    includeZeroBalance: true,
  });

  expect(result.balanced).toBe(true);

  const closingDiff = Math.abs(
    Number(result.totalClosingDebit) - Number(result.totalClosingCredit),
  );
  expect(closingDiff).toBeLessThanOrEqual(0.01);
});

// ─── TB-02 ────────────────────────────────────────────────────────────────────
it('TB-02: trial balance includes bank and revenue accounts that had activity', async () => {
  const result = await svc.trialBalanceService.generate(env.identity, {
    asOfDate: '2025-01-31',
    includeZeroBalance: false,
  });

  const codes = result.lines.map((l) => l.accountCode);
  expect(codes).toContain(env.accounts.bankCode);
  expect(codes).toContain(env.accounts.revCode);
});

// ─── TB-03 ────────────────────────────────────────────────────────────────────
it('TB-03: includeZeroBalance = false excludes accounts with zero closing balance', async () => {
  const withZero    = await svc.trialBalanceService.generate(env.identity, { asOfDate: '2025-01-31', includeZeroBalance: true });
  const withoutZero = await svc.trialBalanceService.generate(env.identity, { asOfDate: '2025-01-31', includeZeroBalance: false });

  // Filter flag must reduce or equal the number of lines
  expect(withoutZero.lines.length).toBeLessThanOrEqual(withZero.lines.length);

  // Every line in withoutZero must have a non-zero closing balance
  for (const line of withoutZero.lines) {
    const closingDebit  = Number(line.closingDebit);
    const closingCredit = Number(line.closingCredit);
    expect(closingDebit + closingCredit).toBeGreaterThan(0);
  }
});

// ─── TB-04 ────────────────────────────────────────────────────────────────────
it('TB-04: trial balance for a CLOSED period with a valid snapshot uses the snapshot', async () => {
  // The fixture has period 3 (Mar 2025) as CLOSED but no snapshot yet.
  // Generate a snapshot for it manually, then query TB using it.
  const freshEnv = await AccountingFixtureFactory.create(prisma);

  try {
    // Post a journal in the "closed" period by directly manipulating period status
    // so we can create a real snapshot.
    // Strategy: mark the closed period OPEN, post a journal, lock it, generate snapshot, close it.
    await prisma.accountingPeriod.update({
      where: { id: freshEnv.periods.closedId },
      data: { status: 'OPEN' },
    });

    await prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: freshEnv.orgId,
          accountingDate: new Date('2025-03-15'),
          documentDate:   new Date('2025-03-15'),
          description:    'TB-04 snapshot seed',
          currencyCode:   'USD',
          eventType:      `EVT-TB04-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `tb04-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          freshEnv.identity.userId,
          lines: [
            { accountId: freshEnv.accounts.bankId, debitAmount: new Decimal('400'), creditAmount: new Decimal(0) },
            { accountId: freshEnv.accounts.revId,  debitAmount: new Decimal(0),    creditAmount: new Decimal('400') },
          ],
        },
        tx as never,
      ),
    );

    // Generate snapshot for the closed period
    const snapshot = await svc.snapshotService.generateForPeriod(
      freshEnv.orgId,
      freshEnv.periods.closedId,
      freshEnv.identity.userId,
    );
    expect(snapshot.accountsSnapshotted).toBeGreaterThanOrEqual(2);

    // Mark period CLOSED so TB uses snapshot path
    await prisma.accountingPeriod.update({
      where: { id: freshEnv.periods.closedId },
      data: { status: 'CLOSED' },
    });

    const result = await svc.trialBalanceService.generate(freshEnv.identity, {
      asOfDate: '2025-03-31',
      includeZeroBalance: false,
    });

    expect(result.balanced).toBe(true);
    const bankLine = result.lines.find((l) => l.accountCode === freshEnv.accounts.bankCode);
    expect(bankLine).toBeDefined();
    // The snapshot should show the 400 we posted
    expect(Number(bankLine!.closingDebit)).toBeGreaterThanOrEqual(400);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── TB-05 ────────────────────────────────────────────────────────────────────
it('TB-05: trial balance is org-scoped — other org entries never appear', async () => {
  const otherEnv = await AccountingFixtureFactory.create(prisma);

  try {
    // Post a very large amount in the other org
    await prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: otherEnv.orgId,
          accountingDate: new Date('2025-01-20'),
          documentDate:   new Date('2025-01-20'),
          description:    'TB-05 other org',
          currencyCode:   'USD',
          eventType:      `EVT-TB05-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `tb05-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          otherEnv.identity.userId,
          lines: [
            { accountId: otherEnv.accounts.bankId, debitAmount: new Decimal('99999'), creditAmount: new Decimal(0) },
            { accountId: otherEnv.accounts.revId,  debitAmount: new Decimal(0),      creditAmount: new Decimal('99999') },
          ],
        },
        tx as never,
      ),
    );

    const result = await svc.trialBalanceService.generate(env.identity, {
      asOfDate: '2025-01-31',
      includeZeroBalance: true,
    });

    // Our trial balance totals must not include the 99999 from the other org
    expect(Number(result.totalClosingDebit)).toBeLessThan(99999);
    // Each line must reference an account in our org
    for (const line of result.lines) {
      expect(line.accountId).toContain(env.orgId);
    }
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, otherEnv.orgId);
  }
});

// ─── TB-06 ────────────────────────────────────────────────────────────────────
it('TB-06: for every line, opening + periodDebit = closingDebit and opening + periodCredit = closingCredit', async () => {
  const result = await svc.trialBalanceService.generate(env.identity, {
    asOfDate: '2025-01-31',
    includeZeroBalance: true,
  });

  for (const line of result.lines) {
    const expectedClosingDebit  = Number(line.openingDebit)  + Number(line.periodDebit);
    const expectedClosingCredit = Number(line.openingCredit) + Number(line.periodCredit);
    expect(Number(line.closingDebit)).toBeCloseTo(expectedClosingDebit, 2);
    expect(Number(line.closingCredit)).toBeCloseTo(expectedClosingCredit, 2);
  }
});
