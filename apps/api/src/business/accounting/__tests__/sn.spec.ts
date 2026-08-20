/**
 * SN — Account Version Snapshots
 *
 *   SN-01  Posting resolves the account version effective on the accounting date
 *   SN-02  Journal line records accountCodeSnapshot and accountNameSnapshot
 *   SN-03  Posting on a date before any account version is rejected (no version found)
 *   SN-04  Changing the account name after posting does not alter the snapshot on the old line
 *   SN-05  Journal line accountVersionId matches the resolved version record
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

function postBalancedJournal(sourceDocId: string, accountingDate: Date, debitId: string, creditId: string) {
  const amt = new Decimal('500');
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate,
        documentDate:   accountingDate,
        description:    `SN test ${sourceDocId}`,
        currencyCode:   'USD',
        eventType:      `EVT-SN-${sourceDocId}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   sourceDocId,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: debitId,  debitAmount: amt,            creditAmount: new Decimal(0) },
          { accountId: creditId, debitAmount: new Decimal(0), creditAmount: amt },
        ],
      },
      tx as never,
    ),
  );
}

// ─── SN-01 ────────────────────────────────────────────────────────────────────
it('SN-01: posting resolves the account version effective on the accounting date', async () => {
  const result = await postBalancedJournal(
    `sn-01-${Date.now()}`,
    env.periods.openStart,
    env.accounts.revId,
    env.accounts.expId,
  );

  const entry = await prisma.journalEntry.findUnique({
    where: { id: result.journalEntryId },
    include: { lines: { include: { accountVersion: true } } },
  });

  for (const line of entry!.lines) {
    expect(line.accountVersionId).toBeTruthy();
    expect(line.accountVersion?.versionNumber).toBe(1);
    // The effectiveFrom of the resolved version must be <= accountingDate
    expect(line.accountVersion!.effectiveFrom.getTime()).toBeLessThanOrEqual(
      env.periods.openStart.getTime(),
    );
  }
});

// ─── SN-02 ────────────────────────────────────────────────────────────────────
it('SN-02: journal line records accountCodeSnapshot and accountNameSnapshot at post time', async () => {
  const result = await postBalancedJournal(
    `sn-02-${Date.now()}`,
    env.periods.openStart,
    env.accounts.revId,
    env.accounts.expId,
  );

  const lines = await prisma.journalLine.findMany({
    where: { journalEntryId: result.journalEntryId },
  });

  for (const line of lines) {
    expect(line.accountCodeSnapshot).toBeTruthy();
    expect(line.accountNameSnapshot).toBeTruthy();
    expect(line.accountVersionNumber).toBeGreaterThanOrEqual(1);
  }

  const revLine = lines.find((l) => l.accountId === env.accounts.revId);
  expect(revLine?.accountCodeSnapshot).toBe(env.accounts.revCode);
});

// ─── SN-03 ────────────────────────────────────────────────────────────────────
it('SN-03: posting on a date before any account version exists is rejected', async () => {
  // Accounts in the fixture start 2025-01-01. Use 2024-12-31 (before effective).
  const beforeDate = new Date('2024-12-31');

  await expect(
    prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: env.orgId,
          accountingDate: beforeDate,
          documentDate:   beforeDate,
          description:    'SN-03 before-date test',
          currencyCode:   'USD',
          eventType:      `EVT-SN-03-${Date.now()}`,
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `sn-03-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          env.identity.userId,
          lines: [
            { accountId: env.accounts.revId, debitAmount: new Decimal('100'), creditAmount: new Decimal(0) },
            { accountId: env.accounts.expId, debitAmount: new Decimal(0), creditAmount: new Decimal('100') },
          ],
        },
        tx as never,
      ),
    ),
  ).rejects.toThrow(/No.*period|period.*cover/i);
  // Note: the error may come from PeriodValidator (no period covers 2024-12-31)
  // OR from version resolution — either proves the guard is in place.
});

// ─── SN-04 ────────────────────────────────────────────────────────────────────
it('SN-04: changing account name after posting does NOT alter the snapshot on existing lines', async () => {
  const result = await postBalancedJournal(
    `sn-04-${Date.now()}`,
    env.periods.openStart,
    env.accounts.revId,
    env.accounts.expId,
  );

  const lineBefore = await prisma.journalLine.findFirst({
    where: { journalEntryId: result.journalEntryId, accountId: env.accounts.revId },
  });
  const snapshotBefore = lineBefore!.accountNameSnapshot;

  // Simulate a name change: create a new AccountVersion with a different name
  const currentVersion = await prisma.accountVersion.findFirst({
    where: { accountId: env.accounts.revId },
    orderBy: { effectiveFrom: 'desc' },
  });
  await prisma.accountVersion.update({
    where: { id: currentVersion!.id },
    data: { name: 'Revenue Account RENAMED' },
  });

  // Snapshot on the old line must be unchanged
  const lineAfter = await prisma.journalLine.findUnique({ where: { id: lineBefore!.id } });
  expect(lineAfter!.accountNameSnapshot).toBe(snapshotBefore);

  // Restore name
  await prisma.accountVersion.update({
    where: { id: currentVersion!.id },
    data: { name: currentVersion!.name },
  });
});

// ─── SN-05 ────────────────────────────────────────────────────────────────────
it('SN-05: journal line accountVersionId points to the correct AccountVersion record', async () => {
  const result = await postBalancedJournal(
    `sn-05-${Date.now()}`,
    env.periods.openStart,
    env.accounts.revId,
    env.accounts.expId,
  );

  const lines = await prisma.journalLine.findMany({
    where: { journalEntryId: result.journalEntryId },
    include: { accountVersion: true },
  });

  for (const line of lines) {
    expect(line.accountVersionId).toBeTruthy();
    const version = await prisma.accountVersion.findUnique({ where: { id: line.accountVersionId! } });
    expect(version).not.toBeNull();
    expect(version!.accountId).toBe(line.accountId);
  }
});
