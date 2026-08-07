const { PrismaClient } = require('@prisma/client');
const { Decimal } = require('@prisma/client/runtime/library');

const prisma = new PrismaClient({ log: ['error'] });

async function main() {
  const orgId = 'test-bill-' + Date.now();
  const userId = 'test-user';

  try {
    // Setup
    await prisma.organization.create({ data: { id: orgId, name: 'Test', slug: 'testbill-'+Date.now(), status: 'ACTIVE' } });
    const apAcct = await prisma.account.create({ data: { id: orgId+'-AP', organizationId: orgId, code: 'AP-001', normalBalance: 'CREDIT', createdBy: userId } });
    await prisma.accountVersion.create({ data: { accountId: apAcct.id, versionNumber: 1, name: 'AP', accountClass: 'LIABILITY', accountSubtype: 'ACCOUNTS_PAYABLE', isPostingAllowed: true, isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY', controlledSubledgerType: 'ACCOUNTS_PAYABLE', effectiveFrom: new Date('2025-01-01'), changedBy: userId } });
    const expAcct = await prisma.account.create({ data: { id: orgId+'-EXP', organizationId: orgId, code: 'EXP-001', normalBalance: 'DEBIT', createdBy: userId } });
    await prisma.accountVersion.create({ data: { accountId: expAcct.id, versionNumber: 1, name: 'Expense', accountClass: 'EXPENSE', accountSubtype: 'ADMINISTRATIVE_EXPENSE', isPostingAllowed: true, isControlAccount: false, controlPostingPolicy: 'UNRESTRICTED', effectiveFrom: new Date('2025-01-01'), changedBy: userId } });
    const fy = await prisma.fiscalYear.create({ data: { organizationId: orgId, name: 'FY2025', startDate: new Date('2025-01-01'), endDate: new Date('2025-12-31'), retainedEarningsAccountId: apAcct.id, status: 'OPEN', createdBy: userId } });
    const period = await prisma.accountingPeriod.create({ data: { organizationId: orgId, fiscalYearId: fy.id, periodNumber: 1, name: 'Jan 2025', startDate: new Date('2025-01-01'), endDate: new Date('2025-01-31'), status: 'OPEN' } });
    const profile = await prisma.postingProfile.create({ data: { organizationId: orgId, code: 'GENERAL-EXPENSE', status: 'ACTIVE', createdBy: userId } });
    await prisma.postingProfileVersion.create({ data: { postingProfileId: profile.id, versionNumber: 1, name: 'General Expense', accountId: expAcct.id, effectiveFrom: new Date('2025-01-01'), changedBy: userId } });
    await prisma.documentNumberSequence.create({ data: { organizationId: orgId, documentType: 'JOURNAL_ENTRY', journalCategory: null, prefix: 'JE-', nextNumber: 1, paddingLength: 6, status: 'ACTIVE' } });

    // Simulate what SupplierBillService.post() does inside the transaction
    await prisma.$transaction(async (tx) => {
      // 1. Look up posting profile (tx query)
      const foundProfile = await tx.postingProfile.findFirst({
        where: { organizationId: orgId, code: 'GENERAL-EXPENSE', status: 'ACTIVE' }
      });
      console.log('Profile found:', foundProfile ? 'YES' : 'NO');

      // 2. Look up posting profile version (tx query)
      const version = await tx.postingProfileVersion.findFirst({
        where: { postingProfileId: profile.id, effectiveFrom: { lte: new Date('2025-01-15') }, OR: [{ effectiveTo: null }] },
        orderBy: { effectiveFrom: 'desc' }
      });
      console.log('Version found:', version ? 'YES' : 'NO');

      const expenseAccountId = version ? version.accountId : expAcct.id;

      // 3. claimNext raw SQL inside transaction
      const rows = await tx.$queryRaw`
        UPDATE document_number_sequences
        SET next_number = next_number + 1, version = version + 1
        WHERE organization_id = ${orgId}
          AND document_type = 'JOURNAL_ENTRY'::"DocumentType"
          AND (journal_category = null::"JournalCategory" OR journal_category IS NULL)
          AND status = 'ACTIVE'
        RETURNING prefix, next_number - 1 AS allocated, padding_length
      `;
      console.log('Sequence claimed:', rows.length > 0 ? rows[0] : 'NOT FOUND');

      // 4. Create journal entry with SYSTEM_AP postingOrigin
      const now = new Date();
      const entry = await tx.journalEntry.create({
        data: {
          organizationId: orgId,
          journalNumber: 'JE-000001',
          accountingPeriodId: period.id,
          journalCategory: 'ACCOUNTS_PAYABLE',
          entryPurpose: 'NORMAL',
          status: 'POSTED',
          documentDate: now,
          accountingDate: now,
          postedAt: now,
          description: 'Test Bill',
          currencyCode: 'USD',
          sourceDocumentType: 'SUPPLIER_BILL',
          sourceDocumentId: 'TEST-BILL-001',
          accountingEventId: 'EVT-AP-001',
          createdBy: userId,
          postedBy: userId,
          lines: {
            create: [
              { lineNumber: 1, accountId: expenseAccountId, accountCodeSnapshot: 'EXP-001', accountNameSnapshot: 'Expense', accountVersionNumber: 1, debitAmount: 1000, creditAmount: 0, transactionCurrencyCode: 'USD', baseCurrencyAmount: 1000, postingOrigin: 'SYSTEM_AP' },
              { lineNumber: 2, accountId: apAcct.id, accountCodeSnapshot: 'AP-001', accountNameSnapshot: 'AP', accountVersionNumber: 1, debitAmount: 0, creditAmount: 1000, transactionCurrencyCode: 'USD', baseCurrencyAmount: 1000, postingOrigin: 'SYSTEM_AP', sourceSubledgerType: 'ACCOUNTS_PAYABLE' }
            ]
          }
        },
        select: { id: true }
      });
      console.log('SUCCESS! Journal entry created:', entry.id);
    });
  } catch(e) {
    console.error('FAILED:', e.message.split('\n').slice(0, 3).join(' | '));
  } finally {
    try {
      await prisma.$executeRaw`DELETE FROM journal_lines WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE organization_id = ${orgId})`;
      await prisma.$executeRaw`DELETE FROM journal_entries WHERE organization_id = ${orgId}`;
      await prisma.$executeRaw`DELETE FROM document_number_sequences WHERE organization_id = ${orgId}`;
      await prisma.$executeRaw`DELETE FROM posting_profile_versions WHERE posting_profile_id IN (SELECT id FROM posting_profiles WHERE organization_id = ${orgId})`;
      await prisma.$executeRaw`DELETE FROM posting_profiles WHERE organization_id = ${orgId}`;
      await prisma.$executeRaw`DELETE FROM account_versions WHERE account_id IN (SELECT id FROM accounts WHERE organization_id = ${orgId})`;
      await prisma.$executeRaw`DELETE FROM accounting_periods WHERE organization_id = ${orgId}`;
      await prisma.$executeRaw`DELETE FROM fiscal_years WHERE organization_id = ${orgId}`;
      await prisma.$executeRaw`DELETE FROM accounts WHERE organization_id = ${orgId}`;
      await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
    } catch(ce) { console.error('Cleanup error:', ce.message.slice(0,50)); }
    await prisma.$disconnect();
  }
}
main();
