/**
 * Accounting Phase 1 Seed — ACCO Configuration
 *
 * Idempotent: safe to run multiple times.
 * Usage:  npx tsx prisma/seeds/accounting-phase1.seed.ts
 *
 * Requires DATABASE_URL pointing to the ACCO tenant database.
 * Requires ACCO_ORG_SLUG (defaults to "acco").
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const ORG_SLUG = process.env.ACCO_ORG_SLUG ?? 'acco';
const SEED_USER = 'seed:accounting-phase1';

async function main() {
  // ── Resolve organization ──────────────────────────────────────────────────
  const org = await prisma.organization.findFirst({ where: { slug: ORG_SLUG } });
  if (!org) {
    throw new Error(`Organization with slug "${ORG_SLUG}" not found. Run the org seed first.`);
  }
  const orgId = org.id;
  console.log(`Seeding accounting config for org: ${org.name} (${orgId})`);

  // ── 1. Monetary policy ────────────────────────────────────────────────────
  await prisma.monetaryPolicy.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, baseCurrencyCode: 'USD', reportingCurrencyCode: 'USD', updatedBy: SEED_USER },
    update: { baseCurrencyCode: 'USD', reportingCurrencyCode: 'USD', updatedBy: SEED_USER },
  });
  console.log('  ✓ MonetaryPolicy');

  // ── 2. Fiscal calendar policy ─────────────────────────────────────────────
  await prisma.fiscalCalendarPolicy.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      fiscalYearStartMonth: 1,
      fiscalYearStartDay: 1,
      useAdjustmentPeriods: false,
      updatedBy: SEED_USER,
    },
    update: { fiscalYearStartMonth: 1, fiscalYearStartDay: 1, useAdjustmentPeriods: false, updatedBy: SEED_USER },
  });
  console.log('  ✓ FiscalCalendarPolicy');

  // ── 3. Tax policy (codes created below) ───────────────────────────────────
  await prisma.taxPolicy.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, updatedBy: SEED_USER },
    update: { updatedBy: SEED_USER },
  });
  console.log('  ✓ TaxPolicy');

  // ── 4. Numbering policy ───────────────────────────────────────────────────
  await prisma.numberingPolicy.upsert({
    where: { organizationId: orgId },
    create: { organizationId: orgId, numberingScope: 'CONTINUOUS', updatedBy: SEED_USER },
    update: { numberingScope: 'CONTINUOUS', updatedBy: SEED_USER },
  });
  console.log('  ✓ NumberingPolicy');

  // ── 5. Posting policy ─────────────────────────────────────────────────────
  await prisma.postingPolicy.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      requireFourEyesOnJournals: true,
      draftJournalsBlockPeriodClose: true,
      enforceControlAccountAtDb: true,
      updatedBy: SEED_USER,
    },
    update: {
      requireFourEyesOnJournals: true,
      draftJournalsBlockPeriodClose: true,
      enforceControlAccountAtDb: true,
      updatedBy: SEED_USER,
    },
  });
  console.log('  ✓ PostingPolicy');

  // ── 6. Dimension policy ───────────────────────────────────────────────────
  await prisma.dimensionPolicy.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      projectDimensionDefault: 'REQUIRED',
      departmentDimensionDefault: 'REQUIRED',
      costCenterDimensionDefault: 'OPTIONAL',
      updatedBy: SEED_USER,
    } as never,
    update: {
      projectDimensionDefault: 'REQUIRED',
      departmentDimensionDefault: 'REQUIRED',
      costCenterDimensionDefault: 'OPTIONAL',
      updatedBy: SEED_USER,
    } as never,
  });
  console.log('  ✓ DimensionPolicy');

  // ── 7. Banking policy ─────────────────────────────────────────────────────
  await prisma.bankingPolicy.upsert({
    where: { organizationId: orgId },
    create: {
      organizationId: orgId,
      requireBankAccountForReceipts: true,
      requireBankAccountForPayments: true,
      requireBankReviewBeforeClose: false,
      updatedBy: SEED_USER,
    },
    update: {
      requireBankAccountForReceipts: true,
      requireBankAccountForPayments: true,
      requireBankReviewBeforeClose: false,
      updatedBy: SEED_USER,
    },
  });
  console.log('  ✓ BankingPolicy');

  // ── Shared constant ───────────────────────────────────────────────────────
  const EFFECTIVE_FROM = new Date('2026-01-01');

  // ── 8. Tax codes ──────────────────────────────────────────────────────────
  await prisma.taxCode.upsert({
    where: { organizationId_code: { organizationId: orgId, code: 'VAT5_OUT' } },
    create: {
      organizationId: orgId, code: 'VAT5_OUT', name: 'Output VAT 5%',
      rate: 5, taxType: 'VAT', recoveryMethod: 'FULLY_RECOVERABLE',
      effectiveFrom: EFFECTIVE_FROM, status: 'ACTIVE', createdBy: SEED_USER,
    },
    update: { rate: 5, status: 'ACTIVE' },
  });
  await prisma.taxCode.upsert({
    where: { organizationId_code: { organizationId: orgId, code: 'VAT5_IN' } },
    create: {
      organizationId: orgId, code: 'VAT5_IN', name: 'Input VAT 5% (Non-Recoverable)',
      rate: 5, taxType: 'VAT', recoveryMethod: 'NON_RECOVERABLE',
      effectiveFrom: EFFECTIVE_FROM, status: 'ACTIVE', createdBy: SEED_USER,
    },
    update: { rate: 5, status: 'ACTIVE' },
  });
  console.log('  ✓ TaxCodes (VAT5_OUT, VAT5_IN)');

  // ── 9. Minimum COA ────────────────────────────────────────────────────────
  type CoaRow = {
    code: string; name: string;
    accountClass: string; accountSubtype: string; normalBalance: string;
    isPostingAllowed: boolean; isControlAccount: boolean;
    controlledSubledgerType?: string; controlPostingPolicy: string;
  };

  const COA: CoaRow[] = [
    { code: '10100', name: 'Salaam Bank',               accountClass: 'ASSET',     accountSubtype: 'CASH_AND_BANK',             normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'SYSTEM_OR_APPROVED_ADJUSTMENT' },
    { code: '10200', name: 'Dahabshiil Bank',           accountClass: 'ASSET',     accountSubtype: 'CASH_AND_BANK',             normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'SYSTEM_OR_APPROVED_ADJUSTMENT' },
    { code: '11000', name: 'Accounts Receivable',       accountClass: 'ASSET',     accountSubtype: 'ACCOUNTS_RECEIVABLE',       normalBalance: 'DEBIT',  isPostingAllowed: false, isControlAccount: true,  controlledSubledgerType: 'ACCOUNTS_RECEIVABLE', controlPostingPolicy: 'SYSTEM_ONLY' },
    { code: '11500', name: 'Unapplied Client Receipts', accountClass: 'LIABILITY', accountSubtype: 'UNAPPLIED_CLIENT_RECEIPTS', normalBalance: 'CREDIT', isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'SYSTEM_ONLY' },
    { code: '12100', name: 'Inventory Asset',           accountClass: 'ASSET',     accountSubtype: 'INVENTORY',                 normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '15000', name: 'Fixed Assets',              accountClass: 'ASSET',     accountSubtype: 'FIXED_ASSETS',              normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '17000', name: 'Prepaid Expenses',          accountClass: 'ASSET',     accountSubtype: 'PREPAYMENTS',               normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '20000', name: 'Accounts Payable',          accountClass: 'LIABILITY', accountSubtype: 'ACCOUNTS_PAYABLE',          normalBalance: 'CREDIT', isPostingAllowed: false, isControlAccount: true,  controlledSubledgerType: 'ACCOUNTS_PAYABLE', controlPostingPolicy: 'SYSTEM_ONLY' },
    { code: '20100', name: 'Supplier Advance',          accountClass: 'ASSET',     accountSubtype: 'SUPPLIER_ADVANCE',          normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'SYSTEM_ONLY' },
    { code: '20200', name: 'Output VAT Payable',        accountClass: 'LIABILITY', accountSubtype: 'VAT_OUTPUT_PAYABLE',        normalBalance: 'CREDIT', isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'SYSTEM_OR_APPROVED_ADJUSTMENT' },
    { code: '30000', name: 'ASAS Group Capital',        accountClass: 'EQUITY',    accountSubtype: 'SHARE_CAPITAL',             normalBalance: 'CREDIT', isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '31000', name: 'Retained Earnings',         accountClass: 'EQUITY',    accountSubtype: 'RETAINED_EARNINGS',         normalBalance: 'CREDIT', isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '42600', name: 'Project Income',            accountClass: 'INCOME',    accountSubtype: 'PROJECT_REVENUE',           normalBalance: 'CREDIT', isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '50303', name: 'Cement Cost',               accountClass: 'COST_OF_SALES', accountSubtype: 'MATERIAL_COST',          normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '60100', name: 'Transport Expense',         accountClass: 'EXPENSE',   accountSubtype: 'ADMINISTRATIVE_EXPENSE',    normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
    { code: '65000', name: 'Depreciation Expense',      accountClass: 'EXPENSE',   accountSubtype: 'DEPRECIATION_EXPENSE',      normalBalance: 'DEBIT',  isPostingAllowed: true,  isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED' },
  ];

  let coaCreated = 0, coaSkipped = 0;
  for (const row of COA) {
    const existing = await prisma.account.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: row.code } },
    });
    if (existing) { coaSkipped++; continue; }

    await prisma.account.create({
      data: {
        organizationId: orgId, code: row.code,
        normalBalance: row.normalBalance as never,
        status: 'ACTIVE', createdBy: SEED_USER,
        versions: {
          create: {
            versionNumber: 1, name: row.name,
            accountClass: row.accountClass as never,
            accountSubtype: row.accountSubtype as never,
            isPostingAllowed: row.isPostingAllowed,
            isControlAccount: row.isControlAccount,
            ...(row.controlledSubledgerType ? { controlledSubledgerType: row.controlledSubledgerType as never } : {}),
            controlPostingPolicy: row.controlPostingPolicy as never,
            effectiveFrom: EFFECTIVE_FROM,
            changedBy: SEED_USER,
          },
        },
      },
    });
    coaCreated++;
  }
  console.log(`  ✓ COA: ${coaCreated} created, ${coaSkipped} skipped`);

  // ── 10. Posting profiles ──────────────────────────────────────────────────
  const profiles = [
    { code: 'PROJECT_REVENUE',   name: 'Project Revenue',          glCode: '42600' },
    { code: 'MATERIAL_PURCHASE', name: 'Material Purchase (COGS)', glCode: '50303' },
    { code: 'SUBCONTRACT_COST',  name: 'Subcontract Cost (COGS)',  glCode: '50303' },
    { code: 'OFFICE_EXPENSE',    name: 'Office & Admin Expense',   glCode: '60100' },
  ];

  let profilesCreated = 0;
  for (const p of profiles) {
    const exists = await prisma.postingProfile.findFirst({ where: { organizationId: orgId, code: p.code } });
    if (exists) continue;

    const glAcct = await prisma.account.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: p.glCode } },
    });
    if (!glAcct) { console.warn(`    ! PostingProfile ${p.code}: GL ${p.glCode} not found`); continue; }

    const profile = await prisma.postingProfile.create({
      data: { organizationId: orgId, code: p.code, status: 'ACTIVE', createdBy: SEED_USER },
    });
    await prisma.postingProfileVersion.create({
      data: { postingProfileId: profile.id, versionNumber: 1, name: p.name, accountId: glAcct.id, effectiveFrom: EFFECTIVE_FROM, changedBy: SEED_USER },
    });
    profilesCreated++;
  }
  console.log(`  ✓ PostingProfiles: ${profilesCreated} created`);

  // ── 11. Fiscal year FY2026 ────────────────────────────────────────────────
  const retainedAcct = await prisma.account.findUnique({
    where: { organizationId_code: { organizationId: orgId, code: '31000' } },
  });
  if (!retainedAcct) throw new Error('Retained earnings account 31000 not found — COA must seed first');

  const fyExists = await prisma.fiscalYear.findUnique({
    where: { organizationId_name: { organizationId: orgId, name: 'FY2026' } },
  });
  if (!fyExists) {
    const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    await prisma.fiscalYear.create({
      data: {
        organizationId: orgId,
        name: 'FY2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        retainedEarningsAccountId: retainedAcct.id,
        createdBy: SEED_USER,
        periods: {
          create: MONTHS.map((m, i) => ({
            organizationId: orgId,
            periodNumber: i + 1,
            name: `${m} 2026`,
            startDate: new Date(2026, i, 1),
            endDate: new Date(2026, i + 1, 0),
            periodType: 'OPERATING' as const,
            status: 'OPEN' as const,
          })),
        },
      },
    });
    console.log('  ✓ FiscalYear FY2026 + 12 OPEN periods');
  } else {
    console.log('  · FiscalYear FY2026 already exists — skipped');
  }

  // ── 12. Bank accounts ─────────────────────────────────────────────────────
  // ACCO has 9 bank accounts total per CFO discovery. Only 2 are seeded here
  // for the initial rollout. The remaining 7 will be added during production
  // migration via the Opening Balance Wizard (Phase 2.8).
  const banks = [
    { accountName: 'Salaam Bank',    bankName: 'Salaam Somali Bank',            accountNumber: 'TBD-001', currencyCode: 'USD', glCode: '10100' },
    { accountName: 'Dahabshiil Bank', bankName: 'Dahabshiil Bank International', accountNumber: 'TBD-002', currencyCode: 'USD', glCode: '10200' },
  ];

  let banksCreated = 0;
  for (const b of banks) {
    const glAcct = await prisma.account.findUnique({
      where: { organizationId_code: { organizationId: orgId, code: b.glCode } },
    });
    if (!glAcct) { console.warn(`    ! BankAccount ${b.accountName}: GL ${b.glCode} not found`); continue; }

    const existingBank = await prisma.bankAccount.findFirst({ where: { organizationId: orgId, glAccountId: glAcct.id } });
    if (existingBank) continue;

    await prisma.bankAccount.create({
      data: {
        organizationId: orgId, accountName: b.accountName, bankName: b.bankName,
        accountNumber: b.accountNumber, currencyCode: b.currencyCode,
        glAccountId: glAcct.id, allowsReceipts: true, allowsPayments: true,
        status: 'ACTIVE', createdBy: SEED_USER,
      },
    });
    banksCreated++;
  }
  console.log(`  ✓ BankAccounts: ${banksCreated} created`);

  // ── 13. Document number sequences ─────────────────────────────────────────
  const sequences = [
    { documentType: 'JOURNAL_ENTRY',    journalCategory: null, prefix: 'JE-',   paddingLength: 6 },
    { documentType: 'CLIENT_INVOICE',   journalCategory: null, prefix: 'INV-',  paddingLength: 6 },
    { documentType: 'PAYMENT_RECEIPT',  journalCategory: null, prefix: 'RCP-',  paddingLength: 6 },
    { documentType: 'SUPPLIER_BILL',    journalCategory: null, prefix: 'BILL-', paddingLength: 6 },
    { documentType: 'SUPPLIER_PAYMENT', journalCategory: null, prefix: 'PMT-',  paddingLength: 6 },
  ];

  let seqCreated = 0;
  for (const seq of sequences) {
    const exists = await prisma.documentNumberSequence.findFirst({
      where: {
        organizationId: orgId,
        documentType: seq.documentType as never,
        ...(seq.journalCategory ? { journalCategory: seq.journalCategory as never } : {}),
      },
    });
    if (exists) continue;

    await prisma.documentNumberSequence.create({
      data: {
        organizationId: orgId,
        documentType: seq.documentType as never,
        journalCategory: (seq.journalCategory as never) ?? null,
        prefix: seq.prefix,
        nextNumber: 1,
        paddingLength: seq.paddingLength,
        status: 'ACTIVE',
      },
    });
    seqCreated++;
  }
  console.log(`  ✓ DocumentNumberSequences: ${seqCreated} created`);

  console.log('\nAccounting Phase 1 seed complete ✓');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
