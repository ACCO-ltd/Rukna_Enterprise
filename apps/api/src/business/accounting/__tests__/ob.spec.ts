/**
 * OB — Opening Balance Migration
 *
 *   OB-01  balanced trial balance posts successfully → journal is POSTED
 *   OB-02  unbalanced trial balance is rejected
 *   OB-03  wizard is idempotent (second call throws ConflictException)
 *   OB-04  migrated AR invoices carry postingStatus = OPENING_BALANCE
 *   OB-05  migrated AP bills carry postingStatus = OPENING_BALANCE
 *   OB-06  AR reconciliation shows zero variance after migration
 *   OB-07  AP reconciliation shows zero variance after migration
 *   OB-08  OPENING_BALANCE items are excluded from period-close unposted check
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

const CUTOVER = '2025-01-15';
const BATCH   = `OB-TEST-${Date.now()}`;

// ─── OB-01 ────────────────────────────────────────────────────────────────────
it('OB-01: balanced trial balance posts an OPENING_BALANCE journal', async () => {
  const report = await svc.openingBalanceService.runWizard(env.identity, {
    cutoverDate:    CUTOVER,
    batchReference: BATCH,
    arAccountCode:  env.accounts.arCode,
    apAccountCode:  env.accounts.apCode,
    trialBalance: [
      // Assets
      { accountCode: env.accounts.arCode,   debitBalance: 10000 },
      { accountCode: env.accounts.bankCode,  debitBalance:  5000 },
      // Liabilities
      { accountCode: env.accounts.apCode,   creditBalance:  8000 },
      // Equity
      { accountCode: env.accounts.reCode,   creditBalance:  7000 },
    ],
    openArInvoices: [
      {
        clientId:     env.clientId,
        invoiceRef:   'INV-MIGR-001',
        invoiceDate:  CUTOVER,
        dueDate:      '2025-02-28',
        currencyCode: 'USD',
        subtotal:     9524,
        vatAmount:    476,
        totalAmount:  10000,
      },
    ],
    openApBills: [
      {
        supplierId:           env.supplierId,
        supplierInvoiceNumber: 'SUPP-MIGR-001',
        billDate:             CUTOVER,
        dueDate:              '2025-02-28',
        currencyCode:         'USD',
        subtotal:             7619,
        vatAmount:            381,
        totalAmount:          8000,
        expenseProfileCode:   env.postingProfileCode,
      },
    ],
  });

  expect(report.openingBalanceJournalId).toBeTruthy();
  expect(report.openingBalanceJournalNumber).toMatch(/^JE-/);
  expect(report.arInvoicesImported).toBe(1);
  expect(report.apBillsImported).toBe(1);

  const entry = await prisma.journalEntry.findUnique({ where: { id: report.openingBalanceJournalId } });
  expect(entry?.status).toBe('POSTED');
  expect(entry?.journalCategory).toBe('OPENING_BALANCE');
  expect(entry?.entryPurpose).toBe('OPENING_BALANCE');
});

// ─── OB-02 ────────────────────────────────────────────────────────────────────
it('OB-02: unbalanced trial balance is rejected', async () => {
  await expect(
    svc.openingBalanceService.runWizard(env.identity, {
      cutoverDate:    CUTOVER,
      batchReference: `${BATCH}-unbalanced`,
      arAccountCode:  env.accounts.arCode,
      apAccountCode:  env.accounts.apCode,
      trialBalance: [
        { accountCode: env.accounts.bankCode, debitBalance:  5000 },
        { accountCode: env.accounts.reCode,   creditBalance: 4999 }, // off by 1
      ],
    }),
  ).rejects.toThrow(/balance|∑/i);
});

// ─── OB-03 ────────────────────────────────────────────────────────────────────
it('OB-03: running the wizard a second time is idempotent (throws ConflictException)', async () => {
  // BATCH was already run in OB-01
  await expect(
    svc.openingBalanceService.runWizard(env.identity, {
      cutoverDate:    CUTOVER,
      batchReference: `${BATCH}-dup`,
      arAccountCode:  env.accounts.arCode,
      apAccountCode:  env.accounts.apCode,
      trialBalance: [
        { accountCode: env.accounts.bankCode, debitBalance:  1000 },
        { accountCode: env.accounts.reCode,   creditBalance: 1000 },
      ],
    }),
  ).rejects.toThrow(/already imported|conflict/i);
});

// ─── OB-04 ────────────────────────────────────────────────────────────────────
it('OB-04: migrated AR invoices carry postingStatus = OPENING_BALANCE', async () => {
  const invoices = await prisma.clientInvoice.findMany({
    where: { organizationId: env.orgId, postingStatus: 'OPENING_BALANCE' },
  });
  expect(invoices.length).toBeGreaterThanOrEqual(1);
  expect(invoices[0].migrationBatchId).toBe(BATCH);
  expect(invoices[0].documentStatus).toBe('APPROVED');
  expect(invoices[0].sourceIpcId).toBeNull(); // migrated — no real IPC
});

// ─── OB-05 ────────────────────────────────────────────────────────────────────
it('OB-05: migrated AP bills carry postingStatus = OPENING_BALANCE', async () => {
  const bills = await prisma.supplierBill.findMany({
    where: { organizationId: env.orgId, postingStatus: 'OPENING_BALANCE' },
  });
  expect(bills.length).toBeGreaterThanOrEqual(1);
  expect(bills[0].migrationBatchId).toBe(BATCH);
  expect(bills[0].documentStatus).toBe('APPROVED');
});

// ─── OB-06 ────────────────────────────────────────────────────────────────────
it('OB-06: AR reconciliation shows zero variance after migration', async () => {
  const report = await svc.reconciliationService.runFullReconciliation(env.identity, {
    arAccountCode: env.accounts.arCode,
    apAccountCode: env.accounts.apCode,
  });

  const ar = report.checks.find((c) => c.subledgerType === 'AR');
  expect(ar).toBeDefined();
  // GL debit balance = 10 000, subledger outstanding = 10 000 → variance = 0
  expect(ar?.reconciled).toBe(true);
  expect(parseFloat(ar!.variance)).toBeLessThanOrEqual(0.01);
});

// ─── OB-07 ────────────────────────────────────────────────────────────────────
it('OB-07: AP reconciliation shows zero variance after migration', async () => {
  const report = await svc.reconciliationService.runFullReconciliation(env.identity, {
    arAccountCode: env.accounts.arCode,
    apAccountCode: env.accounts.apCode,
  });

  const ap = report.checks.find((c) => c.subledgerType === 'AP');
  expect(ap).toBeDefined();
  expect(ap?.reconciled).toBe(true);
  expect(parseFloat(ap!.variance)).toBeLessThanOrEqual(0.01);
});

// ─── OB-08 ────────────────────────────────────────────────────────────────────
it('OB-08: OPENING_BALANCE invoices/bills are excluded from period-close unposted check', async () => {
  const readiness = await svc.reconciliationService.getPeriodCloseReadiness(
    env.identity,
    env.periods.openId,
    { arAccountCode: env.accounts.arCode, apAccountCode: env.accounts.apCode },
  );

  // OPENING_BALANCE items must NOT appear in the unposted blockers list
  const hasObBlocker = readiness.blockers.some((b) =>
    b.includes('OPENING_BALANCE') || b.includes('approved client invoice') || b.includes('approved supplier bill'),
  );
  expect(hasObBlocker).toBe(false);
});
