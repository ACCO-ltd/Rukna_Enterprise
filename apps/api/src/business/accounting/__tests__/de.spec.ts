/**
 * DE — Double-entry integrity
 *
 * Verifies that the posting engine:
 *   DE-01  accepts a valid 2-line balanced journal
 *   DE-02  rejects a single-line journal
 *   DE-03  rejects a line carrying both debit AND credit
 *   DE-04  rejects an unbalanced set (∑Dr ≠ ∑Cr)
 *   DE-05  reversal produces a new POSTED journal with swapped amounts
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

// Helper: post a balanced 2-line journal and return { journalEntryId, journalNumber }
async function postTestJournal(sourceDocId: string, debitAccountId: string, creditAccountId: string, amount: Decimal) {
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: env.periods.openStart,
        documentDate:   env.periods.openStart,
        description:    'DE test journal',
        currencyCode:   'USD',
        eventType:      'EVT-DE-001',
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   sourceDocId,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: debitAccountId,  debitAmount: amount, creditAmount: new Decimal(0) },
          { accountId: creditAccountId, debitAmount: new Decimal(0), creditAmount: amount },
        ],
      },
      tx as never,
    ),
  );
}

// ─── DE-01 ────────────────────────────────────────────────────────────────────
it('DE-01: balanced 2-line journal posts and returns a journalEntryId', async () => {
  const result = await postTestJournal(
    `de-01-${Date.now()}`,
    env.accounts.revId,
    env.accounts.expId,
    new Decimal('1000.00'),
  );

  expect(result.journalEntryId).toBeTruthy();
  expect(result.journalNumber).toMatch(/^JE-/);

  const entry = await prisma.journalEntry.findUnique({ where: { id: result.journalEntryId } });
  expect(entry?.status).toBe('POSTED');
  expect(entry?.journalCategory).toBe('GENERAL');
});

// ─── DE-02 ────────────────────────────────────────────────────────────────────
it('DE-02: single-line journal is rejected', async () => {
  await expect(
    prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: env.orgId,
          accountingDate: env.periods.openStart,
          documentDate:   env.periods.openStart,
          description:    'Single-line',
          currencyCode:   'USD',
          eventType:      'EVT-DE-002',
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `de-02-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          env.identity.userId,
          lines: [
            { accountId: env.accounts.revId, debitAmount: new Decimal('500'), creditAmount: new Decimal(0) },
          ],
        },
        tx as never,
      ),
    ),
  ).rejects.toThrow();
});

// ─── DE-03 ────────────────────────────────────────────────────────────────────
it('DE-03: line with both debit and credit is rejected', async () => {
  await expect(
    prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: env.orgId,
          accountingDate: env.periods.openStart,
          documentDate:   env.periods.openStart,
          description:    'Dual side line',
          currencyCode:   'USD',
          eventType:      'EVT-DE-003',
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `de-03-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          env.identity.userId,
          lines: [
            { accountId: env.accounts.revId, debitAmount: new Decimal('500'), creditAmount: new Decimal('500') },
            { accountId: env.accounts.expId, debitAmount: new Decimal(0), creditAmount: new Decimal(0) },
          ],
        },
        tx as never,
      ),
    ),
  ).rejects.toThrow();
});

// ─── DE-04 ────────────────────────────────────────────────────────────────────
it('DE-04: unbalanced journal (∑Dr ≠ ∑Cr) is rejected', async () => {
  await expect(
    prisma.$transaction((tx) =>
      svc.postingService.post(
        {
          organizationId: env.orgId,
          accountingDate: env.periods.openStart,
          documentDate:   env.periods.openStart,
          description:    'Unbalanced',
          currencyCode:   'USD',
          eventType:      'EVT-DE-004',
          sourceDocumentType: 'MANUAL_JOURNAL',
          sourceDocumentId:   `de-04-${Date.now()}`,
          journalCategory:    'GENERAL',
          entryPurpose:       'NORMAL',
          postingOrigin:      'MANUAL',
          createdBy:          env.identity.userId,
          lines: [
            { accountId: env.accounts.revId, debitAmount: new Decimal('1000'), creditAmount: new Decimal(0) },
            { accountId: env.accounts.expId, debitAmount: new Decimal(0), creditAmount: new Decimal('999') },
          ],
        },
        tx as never,
      ),
    ),
  ).rejects.toThrow(/balance|∑/i);
});

// ─── DE-05 ────────────────────────────────────────────────────────────────────
it('DE-05: reversal produces a balanced journal with swapped Dr/Cr', async () => {
  const origDocId  = `de-05-orig-${Date.now()}`;
  const revDocId   = `de-05-rev-${Date.now()}`;
  const amount = new Decimal('2500.00');

  const original = await postTestJournal(origDocId, env.accounts.revId, env.accounts.expId, amount);

  const reversal = await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: env.periods.openStart,
        documentDate:   env.periods.openStart,
        description:    'Reversal of DE-05',
        currencyCode:   'USD',
        eventType:      'EVT-DE-005-REV',
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   revDocId,
        journalCategory:    'GENERAL',
        entryPurpose:       'REVERSAL',
        postingOrigin:      'MANUAL',
        reversalOfJournalEntryId: original.journalEntryId,
        createdBy:          env.identity.userId,
        lines: [
          // Swapped: credit side becomes debit
          { accountId: env.accounts.expId, debitAmount: amount, creditAmount: new Decimal(0) },
          { accountId: env.accounts.revId, debitAmount: new Decimal(0), creditAmount: amount },
        ],
      },
      tx as never,
    ),
  );

  expect(reversal.journalEntryId).not.toBe(original.journalEntryId);

  const entry = await prisma.journalEntry.findUnique({
    where: { id: reversal.journalEntryId },
    include: { lines: true },
  });
  expect(entry?.status).toBe('POSTED');
  expect(entry?.reversalOfJournalEntryId).toBe(original.journalEntryId);

  const totalDr = entry!.lines.reduce((s, l) => s.plus(l.debitAmount  as unknown as Decimal), new Decimal(0));
  const totalCr = entry!.lines.reduce((s, l) => s.plus(l.creditAmount as unknown as Decimal), new Decimal(0));
  expect(totalDr.eq(totalCr)).toBe(true);
});
