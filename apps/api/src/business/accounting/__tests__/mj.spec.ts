/**
 * MJ — Manual Journal lifecycle
 *
 *   MJ-01  DRAFT → SUBMIT → APPROVE → POST produces a POSTED GL entry
 *   MJ-02  Unbalanced draft journal is rejected at post time
 *   MJ-03  MANUAL origin cannot post to a SYSTEM_ONLY control account
 *   MJ-04  Posted manual journal can be reversed (Dr/Cr swapped, new entry)
 *   MJ-05  Posting moves the trial balance by the journal amount — ONCE
 *   MJ-06  Reversing a posted journal returns the accounts to where they started
 *   MJ-07  A journal cannot be reversed twice
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

  // The authoring record is retained for its workflow trail and marked POSTED, but it
  // must no longer carry lines: it is not a second journal. Two line-carrying POSTED
  // entries for one manual journal is what made every report double-count (see MJ-05).
  const draftAfter = await prisma.journalEntry.findUnique({
    where: { id: draft.id },
    include: { lines: true },
  });
  expect(draftAfter?.status).toBe('POSTED');
  expect(draftAfter?.lines).toHaveLength(0);
  expect(draftAfter?.replacedByJournalEntryId).toBe(result.journalEntryId);

  // ...and the canonical entry is the one that carries them.
  expect(glEntry).not.toBeNull();
  const canonicalLines = await prisma.journalLine.count({
    where: { journalEntryId: result.journalEntryId },
  });
  expect(canonicalLines).toBe(2);
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

// ─── MJ-05 ────────────────────────────────────────────────────────────────────
/**
 * The regression test for the double-posting defect.
 *
 * Posting used to create the canonical GL entry *and* leave the authoring record's
 * lines in place, both POSTED. Every report filters on `entry.status = 'POSTED'` and
 * aggregates `JournalLine`, so each manual journal counted twice — in the trial
 * balance, both P&Ls, the balance sheet and project actual cost. Debits and credits
 * doubled together, so the trial balance still balanced and nothing caught it.
 *
 * Asserting on the trial balance rather than on row counts is deliberate: it is the
 * number a person would have had to reconcile by hand to notice.
 */
it('MJ-05: posting moves the trial balance by the journal amount, once', async () => {
  const asOfDate = '2025-01-31';
  const amount = 1234;

  const before = await svc.trialBalanceService.generate(env.identity, { asOfDate });
  const debitBefore = Number(before.totalClosingDebit);
  const creditBefore = Number(before.totalClosingCredit);

  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-16',
    description: 'MJ-05 single-count check',
    currencyCode: 'USD',
    lines: [
      { accountId: env.accounts.expId, debitAmount: amount },
      { accountId: env.accounts.bankId, creditAmount: amount },
    ],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  await svc.manualJournalService.post(env.identity, draft.id);

  const after = await svc.trialBalanceService.generate(env.identity, { asOfDate });

  // Exactly the journal amount — not twice it.
  expect(Number(after.totalClosingDebit) - debitBefore).toBeCloseTo(amount, 2);
  expect(Number(after.totalClosingCredit) - creditBefore).toBeCloseTo(amount, 2);
  expect(after.balanced).toBe(true);
});

// ─── MJ-06 ────────────────────────────────────────────────────────────────────
/**
 * Scenario G2. Reversal used to move the original out of POSTED *and* post the mirror
 * entry, which subtracts the amount a second time — the accounts would have landed at
 * minus the original. It only ever looked right because the duplicate from MJ-05
 * happened to absorb it. Both defects are fixed, so this now has to hold on its own.
 */
it('MJ-06: reversing a posted journal returns the trial balance to where it started', async () => {
  const asOfDate = '2025-01-31';
  const amount = 640;

  // Net balance of one account, not the gross debit column: a reversal is a second
  // real posting, so gross debits legitimately rise on both the original and the
  // mirror. What must return to zero is the account's net position.
  const netOf = async (code: string): Promise<number> => {
    const tb = await svc.trialBalanceService.generate(env.identity, {
      asOfDate,
      includeZeroBalance: true,
    });
    const line = tb.lines.find((l) => l.accountCode === code);
    if (!line) return 0;
    return Number(line.closingDebit) - Number(line.closingCredit);
  };

  const expBefore = await netOf(env.accounts.expCode);

  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-17',
    description: 'MJ-06 reversal netting',
    currencyCode: 'USD',
    lines: [
      { accountId: env.accounts.expId, debitAmount: amount },
      { accountId: env.accounts.bankId, creditAmount: amount },
    ],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  const posted = await svc.manualJournalService.post(env.identity, draft.id);

  await svc.manualJournalService.reverse(env.identity, {
    journalId: posted.journalEntryId,
    reversalDate: '2025-01-18',
    reason: 'MJ-06 netting check',
  });

  const after = await svc.trialBalanceService.generate(env.identity, { asOfDate });

  // Original + mirror = no net movement. The original stays POSTED: a reversal offsets
  // a posting, it does not erase it.
  expect(await netOf(env.accounts.expCode)).toBeCloseTo(expBefore, 2);
  expect(after.balanced).toBe(true);
  const original = await prisma.journalEntry.findUniqueOrThrow({
    where: { id: posted.journalEntryId },
  });
  expect(original.status).toBe('POSTED');
  expect(original.reversalReason).toBe('MJ-06 netting check');
});

// ─── MJ-07 ────────────────────────────────────────────────────────────────────
it('MJ-07: a journal cannot be reversed twice', async () => {
  const draft = await svc.manualJournalService.create(env.identity, {
    accountingDate: '2025-01-19',
    description: 'MJ-07 double reversal guard',
    currencyCode: 'USD',
    lines: [
      { accountId: env.accounts.expId, debitAmount: 90 },
      { accountId: env.accounts.bankId, creditAmount: 90 },
    ],
  });
  await svc.manualJournalService.submit(env.identity, draft.id);
  await svc.manualJournalService.approve(env.identity, { journalId: draft.id, approved: true });
  const posted = await svc.manualJournalService.post(env.identity, draft.id);

  await svc.manualJournalService.reverse(env.identity, {
    journalId: posted.journalEntryId,
    reversalDate: '2025-01-20',
    reason: 'first reversal',
  });

  await expect(
    svc.manualJournalService.reverse(env.identity, {
      journalId: posted.journalEntryId,
      reversalDate: '2025-01-21',
      reason: 'second reversal',
    }),
  ).rejects.toThrow(/already reversed/i);

  // Reversing via the authoring record's id must hit the same guard, not slip past it.
  await expect(
    svc.manualJournalService.reverse(env.identity, {
      journalId: draft.id,
      reversalDate: '2025-01-21',
      reason: 'second reversal via staging id',
    }),
  ).rejects.toThrow(/already reversed/i);
});
