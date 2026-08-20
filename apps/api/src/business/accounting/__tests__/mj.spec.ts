/**
 * MJ — Manual Journal lifecycle
 *
 *   MJ-01  DRAFT → SUBMIT → APPROVE → POST produces a POSTED GL entry
 *   MJ-02  Unbalanced draft journal is rejected at post time
 *   MJ-03  MANUAL origin cannot post to a SYSTEM_ONLY control account
 *   MJ-04  Posted manual journal can be reversed (Dr/Cr swapped, new entry)
 */

import { PrismaClient } from '@prisma/client';
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

// ─── MJ-01 ────────────────────────────────────────────────────────────────────
it('MJ-01: full lifecycle DRAFT→SUBMIT→APPROVE→POST produces a POSTED GL entry', async () => {
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-15',
    description:    'Test MJ-01',
    currencyCode:   'USD',
    lines: [
      { accountId: env.accounts.revId, debitAmount:  500 },
      { accountId: env.accounts.expId, creditAmount: 500 },
    ],
  });

  expect(draft.status).toBe('DRAFT');

  await svc.manualJournalService.submit(env.identity, draft.id);

  await svc.manualJournalService.approve(env.identity, {
    journalId: draft.id,
    approved:  true,
  });

  const result = await svc.manualJournalService.post(env.identity, draft.id);
  expect(result.journalEntryId).toBeTruthy();

  // The GL entry created by the posting engine must be POSTED
  const glEntry = await prisma.journalEntry.findUnique({ where: { id: result.journalEntryId } });
  expect(glEntry?.status).toBe('POSTED');
  expect(glEntry?.sourceDocumentType).toBe('MANUAL_JOURNAL');

  // The original draft must also be marked POSTED
  const draftAfter = await prisma.journalEntry.findUnique({ where: { id: draft.id } });
  expect(draftAfter?.status).toBe('POSTED');
});

// ─── MJ-02 ────────────────────────────────────────────────────────────────────
it('MJ-02: posting an unbalanced draft is rejected', async () => {
  // Create an intentionally unbalanced journal (will be rejected at post time)
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-15',
    description:    'Unbalanced MJ-02',
    currencyCode:   'USD',
    lines: [
      { accountId: env.accounts.revId, debitAmount:  1000 },
      { accountId: env.accounts.expId, creditAmount:  999 },
    ],
  });

  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });

  await expect(
    svc.manualJournalService.post(env.identity, draft.id),
  ).rejects.toThrow(/balance|∑/i);
});

// ─── MJ-03 ────────────────────────────────────────────────────────────────────
it('MJ-03: MANUAL origin is blocked from posting to a SYSTEM_ONLY control account', async () => {
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-15',
    description:    'MJ-03 control account test',
    currencyCode:   'USD',
    lines: [
      { accountId: env.accounts.ctrlId, debitAmount:  100 },
      { accountId: env.accounts.expId,  creditAmount: 100 },
    ],
  });

  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });

  await expect(
    svc.manualJournalService.post(env.identity, draft.id),
  ).rejects.toThrow(/system-only|control account|manual posting/i);
});

// ─── MJ-04 ────────────────────────────────────────────────────────────────────
it('MJ-04: posted manual journal can be reversed with swapped Dr/Cr', async () => {
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-20',
    description:    'MJ-04 to be reversed',
    currencyCode:   'USD',
    lines: [
      { accountId: env.accounts.revId, debitAmount:  750 },
      { accountId: env.accounts.expId, creditAmount: 750 },
    ],
  });

  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  const posted = await svc.manualJournalService.post(env.identity, draft.id);

  const reversal = await svc.manualJournalService.reverse(env.identity, {
    journalId:    posted.journalEntryId,
    reversalDate: '2025-01-21',
    reason:       'MJ-04 test reversal',
  });

  expect(reversal.journalEntryId).not.toBe(posted.journalEntryId);

  const revEntry = await prisma.journalEntry.findUnique({
    where: { id: reversal.journalEntryId },
    include: { lines: true },
  });
  expect(revEntry?.entryPurpose).toBe('REVERSAL');
  expect(revEntry?.reversalOfJournalEntryId).toBe(posted.journalEntryId);

  // Verify the Dr/Cr swap: original had Dr=rev, Cr=exp; reversal should have Dr=exp, Cr=rev
  const revDebitLine  = revEntry!.lines.find((l) => l.accountId === env.accounts.expId);
  const revCreditLine = revEntry!.lines.find((l) => l.accountId === env.accounts.revId);
  expect(Number(revDebitLine?.debitAmount)).toBeGreaterThan(0);
  expect(Number(revCreditLine?.creditAmount)).toBeGreaterThan(0);
});
