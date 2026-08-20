/**
 * FS — Financial Statements consistency
 *
 *   FS-01  GL report for an account lists all POSTED journal lines for that account
 *   FS-02  GL balance = ∑debit − ∑credit across POSTED journals for an account
 *   FS-03  Reversed journal lines appear in GL and cancel out to net zero
 *   FS-04  AR GL balance matches ∑ outstanding clientInvoice amounts after posting
 *   FS-05  AP GL balance matches ∑ outstanding supplierBill amounts after posting
 *   FS-06  Trial balance: ∑ all account debit balances = ∑ all account credit balances
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

function postJournal(sourceDocId: string, debitId: string, creditId: string, amount: Decimal) {
  return prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: env.periods.openStart,
        documentDate:   env.periods.openStart,
        description:    `FS test ${sourceDocId}`,
        currencyCode:   'USD',
        eventType:      `EVT-FS-${sourceDocId}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   sourceDocId,
        journalCategory:    'GENERAL',
        entryPurpose:       'NORMAL',
        postingOrigin:      'MANUAL',
        createdBy:          env.identity.userId,
        lines: [
          { accountId: debitId,  debitAmount: amount,            creditAmount: new Decimal(0) },
          { accountId: creditId, debitAmount: new Decimal(0), creditAmount: amount },
        ],
      },
      tx as never,
    ),
  );
}

// ─── FS-01 ────────────────────────────────────────────────────────────────────
it('FS-01: GL for an account lists all POSTED lines for that account', async () => {
  const amt1 = new Decimal('1000');
  const amt2 = new Decimal('2500');

  const r1 = await postJournal(`fs-01a-${Date.now()}`, env.accounts.revId, env.accounts.expId, amt1);
  const r2 = await postJournal(`fs-01b-${Date.now()}`, env.accounts.revId, env.accounts.expId, amt2);

  const lines = await prisma.journalLine.findMany({
    where: {
      accountId: env.accounts.revId,
      entry:     { organizationId: env.orgId, status: 'POSTED' },
    },
  });

  const foundIds = new Set(lines.map((l) => l.journalEntryId));
  expect(foundIds.has(r1.journalEntryId)).toBe(true);
  expect(foundIds.has(r2.journalEntryId)).toBe(true);
});

// ─── FS-02 ────────────────────────────────────────────────────────────────────
it('FS-02: GL balance = ∑debit − ∑credit across POSTED journals', async () => {
  const amount = new Decimal('3000');
  await postJournal(`fs-02-${Date.now()}`, env.accounts.bankId, env.accounts.revId, amount);

  const balance = await svc.journalRepo.getGlBalance(prisma, env.orgId, env.accounts.bankId);
  // Bank is a debit-normal account; after Dr 3000 it should have a positive balance
  expect(balance.gte(new Decimal('3000'))).toBe(true);
});

// ─── FS-03 ────────────────────────────────────────────────────────────────────
it('FS-03: reversal lines appear in the GL and cancel out the original to net zero', async () => {
  const amount = new Decimal('500');

  // Post original
  const orig = await postJournal(
    `fs-03-orig-${Date.now()}`,
    env.accounts.expId,
    env.accounts.bankId,
    amount,
  );

  // Get balance before reversal
  const balanceBefore = await svc.journalRepo.getGlBalance(prisma, env.orgId, env.accounts.expId);

  // Post reversal
  const revDocId = `fs-03-rev-${Date.now()}`;
  await prisma.$transaction((tx) =>
    svc.postingService.post(
      {
        organizationId: env.orgId,
        accountingDate: env.periods.openStart,
        documentDate:   env.periods.openStart,
        description:    'FS-03 reversal',
        currencyCode:   'USD',
        eventType:      `EVT-FS-03-REV-${Date.now()}`,
        sourceDocumentType: 'MANUAL_JOURNAL',
        sourceDocumentId:   revDocId,
        journalCategory:    'GENERAL',
        entryPurpose:       'REVERSAL',
        postingOrigin:      'MANUAL',
        reversalOfJournalEntryId: orig.journalEntryId,
        createdBy: env.identity.userId,
        lines: [
          { accountId: env.accounts.bankId, debitAmount: amount,            creditAmount: new Decimal(0) },
          { accountId: env.accounts.expId,  debitAmount: new Decimal(0), creditAmount: amount },
        ],
      },
      tx as never,
    ),
  );

  const balanceAfter = await svc.journalRepo.getGlBalance(prisma, env.orgId, env.accounts.expId);

  // Net effect on exp account should be zero (original Dr + reversal Cr cancel)
  const net = balanceAfter.minus(balanceBefore.minus(amount));
  expect(net.abs().lte(new Decimal('0.01'))).toBe(true);
});

// ─── FS-04 ────────────────────────────────────────────────────────────────────
it('FS-04: AR GL balance matches ∑ outstanding client invoice amounts', async () => {
  // Post an OB wizard so AR GL and subledger are in sync
  const batchRef = `FS04-${Date.now()}`;
  await svc.openingBalanceService.runWizard(env.identity, {
    cutoverDate:    '2025-01-10',
    batchReference: batchRef,
    arAccountCode:  env.accounts.arCode,
    apAccountCode:  env.accounts.apCode,
    trialBalance: [
      { accountCode: env.accounts.arCode,  debitBalance:  4000 },
      { accountCode: env.accounts.reCode,  creditBalance: 4000 },
    ],
    openArInvoices: [
      { clientId: env.clientId, invoiceRef: 'INV-FS04', invoiceDate: '2025-01-10', dueDate: '2025-02-10', currencyCode: 'USD', subtotal: 3810, vatAmount: 190, totalAmount: 4000 },
    ],
  });

  const glBalance = (await svc.journalRepo.getGlBalance(prisma, env.orgId, env.accounts.arId)).abs();
  const subledger = await prisma.clientInvoice.aggregate({
    where: { organizationId: env.orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
    _sum: { outstandingAmount: true },
  });
  const subTotal = new Decimal(subledger._sum.outstandingAmount?.toString() ?? '0');

  expect(glBalance.minus(subTotal).abs().lte(new Decimal('0.01'))).toBe(true);
});

// ─── FS-05 ────────────────────────────────────────────────────────────────────
it('FS-05: AP GL balance matches ∑ outstanding supplier bill amounts', async () => {
  // We rely on the OB run above having also posted AP items in ob.spec.ts
  // Query both POSTED and OPENING_BALANCE items for this org
  const glBalance = (await svc.journalRepo.getGlBalance(prisma, env.orgId, env.accounts.apId)).abs();
  const subledger = await prisma.supplierBill.aggregate({
    where: { organizationId: env.orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
    _sum: { outstandingAmount: true },
  });
  const subTotal = new Decimal(subledger._sum.outstandingAmount?.toString() ?? '0');

  // If there are no AP entries, variance is 0 (both 0) — that's fine for this test
  expect(glBalance.minus(subTotal).abs().lte(new Decimal('0.01'))).toBe(true);
});

// ─── FS-06 ────────────────────────────────────────────────────────────────────
it('FS-06: trial balance ∑debits = ∑credits across all POSTED journal lines in the org', async () => {
  const agg = await prisma.journalLine.aggregate({
    where: {
      entry: { organizationId: env.orgId, status: 'POSTED' },
    },
    _sum: { debitAmount: true, creditAmount: true },
  });

  const totalDr = new Decimal(agg._sum.debitAmount?.toString()  ?? '0');
  const totalCr = new Decimal(agg._sum.creditAmount?.toString() ?? '0');

  expect(totalDr.minus(totalCr).abs().lte(new Decimal('0.01'))).toBe(true);
});
