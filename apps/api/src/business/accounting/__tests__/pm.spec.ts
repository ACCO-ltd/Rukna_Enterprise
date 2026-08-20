/**
 * PM — Period Management and Snapshots
 *
 *   PM-01  lockPeriod OPEN → LOCKED succeeds when no blocking journals exist
 *   PM-02  lockPeriod is blocked when DRAFT journals exist in the period
 *   PM-03  closePeriod LOCKED → CLOSED generates PeriodAccountBalance snapshots
 *   PM-04  Snapshot for a closed period has balanced debit/credit totals
 *   PM-05  reopenPeriod CLOSED → REOPENED invalidates this period's snapshots
 *   PM-06  reopenPeriod invalidates downstream period snapshots
 *   PM-07  rebuildFromPeriod regenerates VALID snapshots sequentially
 *   PM-08  closePeriod is blocked when AR reconciliation fails (pending invoices)
 *   PM-09  validateCloseGate returns blockers without mutating period status
 *   PM-10  Period state machine: OPEN → LOCKED → CLOSED → REOPENED → LOCKED → CLOSED
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

// Helper: post a balanced journal in a period date
function postBalanced(id: string, date: Date) {
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: date,
        documentDate:   date,
        description:    `PM test ${id}`,
        currencyCode:   'USD',
        eventType:      `EVT-PM-${id}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   id,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: new Decimal('100'), creditAmount: new Decimal(0) },
          { accountId: env.accounts.revId,  debitAmount: new Decimal(0),   creditAmount: new Decimal('100') },
        ],
      },
      tx as never,
    ),
  );
}

// ─── PM-01 ────────────────────────────────────────────────────────────────────
it('PM-01: lockPeriod succeeds on an OPEN period with no blocking journals', async () => {
  // Use a dedicated fresh env so we don't disturb shared env periods
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Post and immediately have a POSTED journal — no DRAFT blocking
    await postBalanced(`pm01-${Date.now()}`, freshEnv.periods.openStart);

    const result = await freshSvc.periodManagementService.lockPeriod(
      freshEnv.identity,
      freshEnv.periods.openId,
    );

    expect(result.newStatus).toBe('LOCKED');
    expect(result.previousStatus).toBe('OPEN');

    const period = await prisma.accountingPeriod.findUnique({
      where: { id: freshEnv.periods.openId },
    });
    expect(period?.status).toBe('LOCKED');
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-02 ────────────────────────────────────────────────────────────────────
it('PM-02: lockPeriod is blocked when DRAFT journals exist in the period', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Create a DRAFT journal entry directly in DB (skip posting workflow)
    const ts02 = Date.now();
    await prisma.journalEntry.create({
      data: {
        organizationId:    freshEnv.orgId,
        journalNumber:     `DRAFT-PM02-${ts02}`,
        accountingDate:    freshEnv.periods.openStart,
        documentDate:      freshEnv.periods.openStart,
        accountingPeriodId: freshEnv.periods.openId,
        description:       'PM-02 blocking draft',
        currencyCode:      'USD',
        status:            'DRAFT',
        journalCategory:   'GENERAL',
        entryPurpose:      'NORMAL',
        createdBy:         freshEnv.identity.userId,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:  `pm02-draft-${ts02}`,
        accountingEventId: `EVT-PM02-${ts02}`,
      },
    });

    await expect(
      freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId),
    ).rejects.toThrow(/journal.*not.*posted|draft.*submitted|cannot be locked/i);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-03 ────────────────────────────────────────────────────────────────────
it('PM-03: closePeriod generates PeriodAccountBalance snapshots', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Post a journal so there's something to snapshot
    await prisma.$transaction((tx) =>
      freshSvc.postingService.post(
        {
          organizationId: freshEnv.orgId,
          accountingDate: freshEnv.periods.openStart,
          documentDate:   freshEnv.periods.openStart,
          description:    'PM-03 seed',
          currencyCode:   'USD',
          eventType:      `EVT-PM03-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `pm03-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          freshEnv.identity.userId,
          lines: [
            { accountId: freshEnv.accounts.bankId, debitAmount: new Decimal('250'), creditAmount: new Decimal(0) },
            { accountId: freshEnv.accounts.revId,  debitAmount: new Decimal(0),   creditAmount: new Decimal('250') },
          ],
        },
        tx as never,
      ),
    );

    // Lock first
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);

    // Close
    const closeResult = await freshSvc.periodManagementService.closePeriod(
      freshEnv.identity,
      freshEnv.periods.openId,
    );

    expect(closeResult.newStatus).toBe('CLOSED');
    expect(closeResult.snapshotAccountsCount).toBeGreaterThanOrEqual(2); // bank + rev at minimum

    // Snapshots must exist in DB
    const snapshots = await prisma.periodAccountBalance.findMany({
      where: {
        organizationId:     freshEnv.orgId,
        accountingPeriodId: freshEnv.periods.openId,
        status:             'VALID',
      },
    });
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-04 ────────────────────────────────────────────────────────────────────
it('PM-04: snapshot closing totals are balanced (total closingDebit = total closingCredit)', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Post two balanced journals
    const d = (n: number) => new Decimal(n.toString());
    for (let i = 0; i < 3; i++) {
      await prisma.$transaction((tx) =>
        freshSvc.postingService.post(
          {
            organizationId: freshEnv.orgId,
            accountingDate: new Date('2025-01-10'),
            documentDate:   new Date('2025-01-10'),
            description:    `PM-04 seed ${i}`,
            currencyCode:   'USD',
            eventType:      `EVT-PM04-${i}-${Date.now()}`,
            sourceDocumentType: 'MANUAL_JOURNAL',
            sourceDocumentId:   `pm04-${i}-${Date.now()}`,
            journalCategory:    'GENERAL',
            entryPurpose:       'NORMAL',
            postingOrigin:      'MANUAL',
            createdBy:          freshEnv.identity.userId,
            lines: [
              { accountId: freshEnv.accounts.bankId, debitAmount: d(100 * (i + 1)), creditAmount: d(0) },
              { accountId: freshEnv.accounts.revId,  debitAmount: d(0), creditAmount: d(100 * (i + 1)) },
            ],
          },
          tx as never,
        ),
      );
    }

    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);

    const snapshots = await prisma.periodAccountBalance.findMany({
      where: { organizationId: freshEnv.orgId, accountingPeriodId: freshEnv.periods.openId, status: 'VALID' },
    });

    let totalClosingDebit  = new Decimal(0);
    let totalClosingCredit = new Decimal(0);
    for (const snap of snapshots) {
      totalClosingDebit  = totalClosingDebit.plus(snap.closingDebit);
      totalClosingCredit = totalClosingCredit.plus(snap.closingCredit);
    }

    const diff = totalClosingDebit.minus(totalClosingCredit).abs();
    expect(diff.lte('0.01')).toBe(true);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-05 ────────────────────────────────────────────────────────────────────
it('PM-05: reopenPeriod invalidates the reopened period\'s own snapshots', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Post, lock, close to create snapshots
    await prisma.$transaction((tx) =>
      freshSvc.postingService.post(
        {
          organizationId: freshEnv.orgId,
          accountingDate: freshEnv.periods.openStart,
          documentDate:   freshEnv.periods.openStart,
          description:    'PM-05 seed',
          currencyCode:   'USD',
          eventType:      `EVT-PM05-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `pm05-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          freshEnv.identity.userId,
          lines: [
            { accountId: freshEnv.accounts.bankId, debitAmount: new Decimal('300'), creditAmount: new Decimal(0) },
            { accountId: freshEnv.accounts.revId,  debitAmount: new Decimal(0),   creditAmount: new Decimal('300') },
          ],
        },
        tx as never,
      ),
    );

    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);

    // Confirm snapshots are VALID before reopen
    const beforeReopen = await prisma.periodAccountBalance.findMany({
      where: { organizationId: freshEnv.orgId, accountingPeriodId: freshEnv.periods.openId },
    });
    expect(beforeReopen.every((s) => s.status === 'VALID')).toBe(true);

    // Reopen
    const reopenResult = await freshSvc.periodManagementService.reopenPeriod(freshEnv.identity, {
      periodId: freshEnv.periods.openId,
      reason:   'PM-05 correction test',
    });
    expect(reopenResult.newStatus).toBe('REOPENED');

    // This period's snapshots must now be INVALID
    const afterReopen = await prisma.periodAccountBalance.findMany({
      where: { organizationId: freshEnv.orgId, accountingPeriodId: freshEnv.periods.openId },
    });
    expect(afterReopen.every((s) => s.status === 'INVALID')).toBe(true);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-06 ────────────────────────────────────────────────────────────────────
it('PM-06: reopenPeriod invalidates downstream period snapshots', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    const d = (n: number) => new Decimal(n.toString());

    // Create snapshots for both open and locked periods
    // First: mark locked period as OPEN temporarily to post
    await prisma.accountingPeriod.update({
      where: { id: freshEnv.periods.lockedId },
      data:  { status: 'OPEN' },
    });

    // Post in period 1 (Jan) then period 2 (Feb)
    for (const [dateStr] of [
      ['2025-01-10', freshEnv.periods.openId],
      ['2025-02-10', freshEnv.periods.lockedId],
    ] as const) {
      await prisma.$transaction((tx) =>
        freshSvc.postingService.post(
          {
            organizationId: freshEnv.orgId,
            accountingDate: new Date(dateStr),
            documentDate:   new Date(dateStr),
            description:    `PM-06 seed ${dateStr}`,
            currencyCode:   'USD',
            eventType:      `EVT-PM06-${dateStr}-${Date.now()}`,
            sourceDocumentType: 'MANUAL_JOURNAL',
            sourceDocumentId:   `pm06-${dateStr}-${Date.now()}`,
            journalCategory:    'GENERAL',
            entryPurpose:       'NORMAL',
            postingOrigin:      'MANUAL',
            createdBy:          freshEnv.identity.userId,
            lines: [
              { accountId: freshEnv.accounts.bankId, debitAmount: d(100), creditAmount: d(0) },
              { accountId: freshEnv.accounts.revId,  debitAmount: d(0),   creditAmount: d(100) },
            ],
          },
          tx as never,
        ),
      );
    }

    // Lock and close period 1 to create its snapshot
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);

    // Lock and close period 2 to create its snapshot
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.lockedId);
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.lockedId);

    // Confirm period 2 has VALID snapshots
    const p2Before = await prisma.periodAccountBalance.findMany({
      where: { organizationId: freshEnv.orgId, accountingPeriodId: freshEnv.periods.lockedId, status: 'VALID' },
    });
    expect(p2Before.length).toBeGreaterThanOrEqual(1);

    // Now reopen period 1 — must invalidate period 2's snapshots
    await freshSvc.periodManagementService.reopenPeriod(freshEnv.identity, {
      periodId: freshEnv.periods.openId,
      reason:   'PM-06 downstream invalidation test',
    });

    const p2After = await prisma.periodAccountBalance.findMany({
      where: { organizationId: freshEnv.orgId, accountingPeriodId: freshEnv.periods.lockedId },
    });
    // All snapshots in period 2 must now be INVALID
    expect(p2After.every((s) => s.status === 'INVALID')).toBe(true);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-07 ────────────────────────────────────────────────────────────────────
it('PM-07: rebuildFromPeriod regenerates VALID snapshots sequentially after reopen', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    const d = (n: number) => new Decimal(n.toString());

    // Setup: post, lock, and close period 1
    await prisma.$transaction((tx) =>
      freshSvc.postingService.post(
        {
          organizationId: freshEnv.orgId,
          accountingDate: freshEnv.periods.openStart,
          documentDate:   freshEnv.periods.openStart,
          description:    'PM-07 period 1 seed',
          currencyCode:   'USD',
          eventType:      `EVT-PM07-P1-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `pm07-p1-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          freshEnv.identity.userId,
          lines: [
            { accountId: freshEnv.accounts.bankId, debitAmount: d(500), creditAmount: d(0) },
            { accountId: freshEnv.accounts.revId,  debitAmount: d(0), creditAmount: d(500) },
          ],
        },
        tx as never,
      ),
    );

    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);

    // Reopen period 1 (invalidates its snapshots)
    await freshSvc.periodManagementService.reopenPeriod(freshEnv.identity, {
      periodId: freshEnv.periods.openId,
      reason:   'PM-07 correction',
    });

    // Lock and close again (re-close after correction)
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);

    // Call rebuildFromPeriod explicitly — should rebuild from period 1 onward
    const rebuildResults = await freshSvc.snapshotService.rebuildFromPeriod(
      freshEnv.orgId,
      freshEnv.periods.openId,
      freshEnv.identity.userId,
    );

    expect(rebuildResults.length).toBeGreaterThanOrEqual(1);
    expect(rebuildResults[0].accountingPeriodId).toBe(freshEnv.periods.openId);
    expect(rebuildResults[0].accountsSnapshotted).toBeGreaterThanOrEqual(2);

    // Snapshots in period 1 must be VALID again
    const snapshots = await prisma.periodAccountBalance.findMany({
      where: { organizationId: freshEnv.orgId, accountingPeriodId: freshEnv.periods.openId, status: 'VALID' },
    });
    expect(snapshots.length).toBeGreaterThanOrEqual(2);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-08 ────────────────────────────────────────────────────────────────────
it('PM-08: closePeriod is blocked when AR reconciliation fails', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Post a journal to create an AR GL balance
    await prisma.$transaction((tx) =>
      freshSvc.postingService.post(
        {
          organizationId: freshEnv.orgId,
          accountingDate: freshEnv.periods.openStart,
          documentDate:   freshEnv.periods.openStart,
          description:    'PM-08 AR GL entry',
          currencyCode:   'USD',
          eventType:      `EVT-PM08-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `pm08-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'SYSTEM_AR',  // bypass MANUAL-origin SYSTEM_ONLY guard
          createdBy:          freshEnv.identity.userId,
          lines: [
            { accountId: freshEnv.accounts.arId,   debitAmount: new Decimal('500'), creditAmount: new Decimal(0) },
            { accountId: freshEnv.accounts.revId,  debitAmount: new Decimal(0),   creditAmount: new Decimal('500') },
          ],
        },
        tx as never,
      ),
    );

    // No corresponding ClientInvoice.outstandingAmount — AR GL ≠ subledger
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);

    await expect(
      freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId),
    ).rejects.toThrow(/reconciliation|variance|AR/i);
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-09 ────────────────────────────────────────────────────────────────────
it('PM-09: validateCloseGate returns blockers without changing period status', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    // Create a DRAFT journal to trigger the lock gate
    const ts09 = Date.now();
    await prisma.journalEntry.create({
      data: {
        organizationId:    freshEnv.orgId,
        journalNumber:     `DRAFT-PM09-${ts09}`,
        accountingDate:    freshEnv.periods.openStart,
        documentDate:      freshEnv.periods.openStart,
        accountingPeriodId: freshEnv.periods.openId,
        description:       'PM-09 draft',
        currencyCode:      'USD',
        status:            'DRAFT',
        journalCategory:   'GENERAL',
        entryPurpose:      'NORMAL',
        createdBy:         freshEnv.identity.userId,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:  `pm09-draft-${ts09}`,
        accountingEventId: `EVT-PM09-${ts09}`,
      },
    });

    const gate = await freshSvc.periodManagementService.validateCloseGate(
      freshEnv.identity,
      freshEnv.periods.openId,
    );

    expect(gate.passed).toBe(false);
    expect(gate.blockers.length).toBeGreaterThan(0);

    // Period status must be unchanged
    const period = await prisma.accountingPeriod.findUnique({
      where: { id: freshEnv.periods.openId },
    });
    expect(period?.status).toBe('OPEN');
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});

// ─── PM-10 ────────────────────────────────────────────────────────────────────
it('PM-10: period can traverse OPEN → LOCKED → CLOSED → REOPENED → LOCKED → CLOSED', async () => {
  const freshEnv = await AccountingFixtureFactory.create(prisma);
  const freshSvc = buildServices(prisma);

  try {
    const d = (n: number) => new Decimal(n.toString());

    const postInPeriod = () =>
      prisma.$transaction((tx) =>
        freshSvc.postingService.post(
          {
            organizationId: freshEnv.orgId,
            accountingDate: freshEnv.periods.openStart,
            documentDate:   freshEnv.periods.openStart,
            description:    'PM-10 seed',
            currencyCode:   'USD',
            eventType:      `EVT-PM10-${Date.now()}-${Math.random()}`,
            sourceDocumentType: 'MANUAL_JOURNAL',
            sourceDocumentId:   `pm10-${Date.now()}-${Math.random()}`,
            journalCategory:    'GENERAL',
            entryPurpose:       'NORMAL',
            postingOrigin:      'MANUAL',
            createdBy:          freshEnv.identity.userId,
            lines: [
              { accountId: freshEnv.accounts.bankId, debitAmount: d(50), creditAmount: d(0) },
              { accountId: freshEnv.accounts.revId,  debitAmount: d(0),  creditAmount: d(50) },
            ],
          },
          tx as never,
        ),
      );

    // OPEN → LOCKED
    await postInPeriod();
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    expect((await prisma.accountingPeriod.findUnique({ where: { id: freshEnv.periods.openId } }))?.status).toBe('LOCKED');

    // LOCKED → CLOSED
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);
    expect((await prisma.accountingPeriod.findUnique({ where: { id: freshEnv.periods.openId } }))?.status).toBe('CLOSED');

    // CLOSED → REOPENED
    await freshSvc.periodManagementService.reopenPeriod(freshEnv.identity, {
      periodId: freshEnv.periods.openId,
      reason:   'PM-10 full cycle test',
    });
    expect((await prisma.accountingPeriod.findUnique({ where: { id: freshEnv.periods.openId } }))?.status).toBe('REOPENED');

    // REOPENED → LOCKED (postInPeriod works because period is REOPENED)
    await postInPeriod();
    await freshSvc.periodManagementService.lockPeriod(freshEnv.identity, freshEnv.periods.openId);
    expect((await prisma.accountingPeriod.findUnique({ where: { id: freshEnv.periods.openId } }))?.status).toBe('LOCKED');

    // LOCKED → CLOSED again
    await freshSvc.periodManagementService.closePeriod(freshEnv.identity, freshEnv.periods.openId);
    expect((await prisma.accountingPeriod.findUnique({ where: { id: freshEnv.periods.openId } }))?.status).toBe('CLOSED');
  } finally {
    await AccountingFixtureFactory.cleanup(prisma, freshEnv.orgId);
  }
});
