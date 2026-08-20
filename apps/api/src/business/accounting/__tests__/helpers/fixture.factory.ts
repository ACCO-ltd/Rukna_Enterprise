/**
 * AccountingFixtureFactory
 *
 * Creates an isolated test organisation with a complete accounting environment:
 * COA accounts, fiscal year + three periods (OPEN / LOCKED / CLOSED),
 * document-number sequences, a client, a supplier, a bank GL account, a
 * BankAccount record, and an IPC chain for AR tests.
 *
 * Each factory instance uses a unique orgId so concurrent test suites never
 * collide.  Call cleanup() in afterAll to remove all created rows.
 */

import { PrismaClient } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';
import { randomUUID } from 'node:crypto';

// ─── Public shape returned to spec files ─────────────────────────────────────

export interface TestAccounts {
  arId: string;   arCode: string;
  apId: string;   apCode: string;
  bankId: string; bankCode: string;
  revId: string;  revCode: string;
  expId: string;  expCode: string;
  unaplId: string; unaplCode: string;
  advOutId: string; advOutCode: string;
  reId: string;   reCode: string;   // retained earnings (equity)
  ctrlId: string; ctrlCode: string; // SYSTEM_ONLY — for MJ-03 test
}

export interface TestPeriods {
  openId: string;   openStart: Date; openEnd: Date;
  lockedId: string; lockedStart: Date; lockedEnd: Date;
  closedId: string; closedStart: Date; closedEnd: Date;
}

export interface AccountingTestEnv {
  orgId: string;
  identity: RequestIdentity;
  accounts: TestAccounts;
  fiscalYearId: string;
  periods: TestPeriods;
  clientId: string;
  supplierId: string;
  bankAccountId: string;
  ipcId: string;            // valid InterimPaymentCertificate.id for AR tests
  postingProfileCode: string;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export class AccountingFixtureFactory {
  static async create(prisma: PrismaClient): Promise<AccountingTestEnv> {
    // Date.now() collides when Jest workers enter this factory in the same
    // millisecond. A UUID keeps parallel integration suites truly isolated.
    const suffix = `t${randomUUID().slice(0, 12)}`;
    const orgId = `test-org-${suffix}`;
    const userId = 'test-user-001';

    // ── 1. Organization ───────────────────────────────────────────────────────
    await prisma.organization.create({
      data: { id: orgId, name: `Test Org ${suffix}`, slug: `test-${suffix}`, status: 'ACTIVE' },
    });

    const identity: RequestIdentity = {
      userId,
      activeOrganizationId: orgId,
      tenantSlug: `test-${suffix}`,
      roles: ['admin'],
      permissions: ['*'],
    };

    // ── 2. COA accounts ───────────────────────────────────────────────────────
    const mkAccount = async (
      code: string,
      normalBalance: 'DEBIT' | 'CREDIT',
      accountClass: string,
      accountSubtype: string,
      extra: {
        isControlAccount?: boolean;
        controlPostingPolicy?: string;
        controlledSubledgerType?: string;
      } = {},
    ) => {
      const account = await prisma.account.create({
        data: { id: `${orgId}-${code}`, organizationId: orgId, code, normalBalance: normalBalance as never, createdBy: userId },
      });
      await prisma.accountVersion.create({
        data: {
          accountId: account.id,
          versionNumber: 1,
          name: `${code} Account`,
          accountClass: accountClass as never,
          accountSubtype: accountSubtype as never,
          isPostingAllowed: true,
          isControlAccount: extra.isControlAccount ?? false,
          controlPostingPolicy: (extra.controlPostingPolicy ?? 'UNRESTRICTED') as never,
          controlledSubledgerType: (extra.controlledSubledgerType ?? null) as never,
          effectiveFrom: new Date('2025-01-01'),
          effectiveTo: null,
          changedBy: userId,
        },
      });
      return account.id;
    };

    const arId   = await mkAccount('AR-TEST',   'DEBIT',  'ASSET',     'ACCOUNTS_RECEIVABLE',     { isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY', controlledSubledgerType: 'ACCOUNTS_RECEIVABLE' });
    const apId   = await mkAccount('AP-TEST',   'CREDIT', 'LIABILITY', 'ACCOUNTS_PAYABLE',        { isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY', controlledSubledgerType: 'ACCOUNTS_PAYABLE' });
    const bankId = await mkAccount('BNK-TEST',  'DEBIT',  'ASSET',     'CASH_AND_BANK');
    const revId  = await mkAccount('REV-TEST',  'CREDIT', 'INCOME',    'PROJECT_REVENUE');
    const expId  = await mkAccount('EXP-TEST',  'DEBIT',  'EXPENSE',   'ADMINISTRATIVE_EXPENSE');
    const unaplId = await mkAccount('UNP-TEST', 'CREDIT', 'LIABILITY', 'UNAPPLIED_CLIENT_RECEIPTS');
    const advOutId = await mkAccount('ADV-TEST','DEBIT',  'ASSET',     'SUPPLIER_ADVANCE');
    const reId   = await mkAccount('RE-TEST',   'CREDIT', 'EQUITY',    'RETAINED_EARNINGS');
    const ctrlId = await mkAccount('CTL-TEST',  'CREDIT', 'LIABILITY', 'ACCOUNTS_PAYABLE',        { isControlAccount: true, controlPostingPolicy: 'SYSTEM_ONLY' });

    // ── 3. Fiscal year + periods ───────────────────────────────────────────────
    const fy = await prisma.fiscalYear.create({
      data: {
        organizationId: orgId,
        name: 'FY2025',
        startDate: new Date('2025-01-01'),
        endDate:   new Date('2025-12-31'),
        retainedEarningsAccountId: reId,
        status: 'OPEN',
        createdBy: userId,
      },
    });

    const openStart  = new Date('2025-01-01');
    const openEnd    = new Date('2025-01-31');
    const lockedStart = new Date('2025-02-01');
    const lockedEnd   = new Date('2025-02-28');
    const closedStart = new Date('2025-03-01');
    const closedEnd   = new Date('2025-03-31');

    const p1 = await prisma.accountingPeriod.create({
      data: {
        organizationId: orgId, fiscalYearId: fy.id,
        periodNumber: 1, name: 'January 2025',
        startDate: openStart, endDate: openEnd, status: 'OPEN',
      },
    });
    const p2 = await prisma.accountingPeriod.create({
      data: {
        organizationId: orgId, fiscalYearId: fy.id,
        periodNumber: 2, name: 'February 2025',
        startDate: lockedStart, endDate: lockedEnd, status: 'LOCKED',
      },
    });
    const p3 = await prisma.accountingPeriod.create({
      data: {
        organizationId: orgId, fiscalYearId: fy.id,
        periodNumber: 3, name: 'March 2025',
        startDate: closedStart, endDate: closedEnd, status: 'CLOSED',
      },
    });

    // ── 4. Document number sequences ──────────────────────────────────────────
    const seqTypes = [
      { documentType: 'JOURNAL_ENTRY',    prefix: 'JE-',   paddingLength: 6 },
      { documentType: 'CLIENT_INVOICE',   prefix: 'INV-',  paddingLength: 6 },
      { documentType: 'PAYMENT_RECEIPT',  prefix: 'RCP-',  paddingLength: 6 },
      { documentType: 'SUPPLIER_BILL',    prefix: 'BILL-', paddingLength: 6 },
      { documentType: 'SUPPLIER_PAYMENT', prefix: 'PMT-',  paddingLength: 6 },
    ] as const;

    for (const seq of seqTypes) {
      await prisma.documentNumberSequence.create({
        data: {
          organizationId: orgId,
          documentType: seq.documentType as never,
          journalCategory: null,
          prefix: seq.prefix,
          nextNumber: 1,
          paddingLength: seq.paddingLength,
          status: 'ACTIVE',
        },
      });
    }

    // ── 5. Client ─────────────────────────────────────────────────────────────
    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        code: 'CLI-001',
        name: 'Test Client Ltd',
        status: 'ACTIVE',
      },
    });

    // ── 6. IPC chain (Project → Boq → BoqVersion → Contract → IPA → IPC) ─────
    const project = await prisma.project.create({
      data: {
        organizationId: orgId,
        code: 'PRJ-001',
        name: 'Test Project',
        status: 'ACTIVE',
        commercialModel: 'CLIENT_CONTRACT',
        participationModel: 'SOLE',
        createdBy: userId,
      },
    });

    const boq = await prisma.boq.create({
      data: { projectId: project.id, organizationId: orgId },
    });

    const boqVersion = await prisma.boqVersion.create({
      data: { boqId: boq.id, versionNumber: 1, status: 'BASELINED', createdBy: userId },
    });

    const contract = await prisma.contract.create({
      data: {
        organizationId: orgId,
        projectId: project.id,
        clientId: client.id,
        boqVersionId: boqVersion.id,
        contractNumber: 'CTR-001',
        contractValue: 500000,
        currency: 'USD',
        billingModel: 'MEASURED_IPC',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });

    const ipa = await prisma.interimPaymentApplication.create({
      data: {
        organizationId: orgId,
        contractId: contract.id,
        status: 'SUBMITTED',
        createdBy: userId,
      },
    });

    const ipc = await prisma.interimPaymentCertificate.create({
      data: {
        organizationId: orgId,
        applicationId: ipa.id,
        certificateNumber: 1,
        status: 'CERTIFIED',
        isEffective: true,
        certifiedTotal: 10500,
        currency: 'USD',
        createdBy: userId,
      },
    });

    // ── 7. Supplier ───────────────────────────────────────────────────────────
    const supplier = await prisma.supplier.create({
      data: {
        organizationId: orgId,
        code: 'SUP-001',
        name: 'Test Supplier LLC',
        status: 'ACTIVE',
      },
    });

    // ── 8. BankAccount (backed by bank GL account) ────────────────────────────
    const bankAccount = await prisma.bankAccount.create({
      data: {
        organizationId: orgId,
        glAccountId: bankId,
        bankName: 'Test Bank',
        accountName: 'Main Operating',
        accountNumber: '1234567890',
        currencyCode: 'USD',
        status: 'ACTIVE',
        createdBy: userId,
      },
    });

    // ── 9. PostingProfile (for SupplierBill expense lines) ────────────────────
    const profileCode = 'GENERAL-EXPENSE';
    const profile = await prisma.postingProfile.create({
      data: {
        organizationId: orgId,
        code: profileCode,
        status: 'ACTIVE',
        createdBy: userId,
      },
    });
    await prisma.postingProfileVersion.create({
      data: {
        postingProfileId: profile.id,
        versionNumber: 1,
        name: 'General Expense',
        accountId: expId,
        effectiveFrom: new Date('2025-01-01'),
        changedBy: userId,
      },
    });

    return {
      orgId,
      identity,
      accounts: {
        arId,   arCode: 'AR-TEST',
        apId,   apCode: 'AP-TEST',
        bankId, bankCode: 'BNK-TEST',
        revId,  revCode: 'REV-TEST',
        expId,  expCode: 'EXP-TEST',
        unaplId, unaplCode: 'UNP-TEST',
        advOutId, advOutCode: 'ADV-TEST',
        reId,   reCode: 'RE-TEST',
        ctrlId, ctrlCode: 'CTL-TEST',
      },
      fiscalYearId: fy.id,
      periods: {
        openId: p1.id, openStart, openEnd,
        lockedId: p2.id, lockedStart, lockedEnd,
        closedId: p3.id, closedStart, closedEnd,
      },
      clientId: client.id,
      supplierId: supplier.id,
      bankAccountId: bankAccount.id,
      ipcId: ipc.id,
      postingProfileCode: profileCode,
    };
  }

  /** Remove all rows created for this org (in FK-safe order). */
  static async cleanup(prisma: PrismaClient, orgId: string): Promise<void> {
    // attachments → lines → entries → allocations → subledger docs → sequences → periods → FY → profiles → bank → accounts → dim → org

    // Reset journal status so the immutable-attachment DB trigger allows cleanup deletes
    await prisma.$executeRaw`UPDATE journal_entries SET status = 'DRAFT' WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM journal_entry_attachments
      WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM journal_lines
      WHERE journal_entry_id IN (SELECT id FROM journal_entries WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM journal_entries WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM client_receipt_allocations
      WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM client_invoices WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM supplier_payment_allocations
      WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM supplier_bill_lines
      WHERE supplier_bill_id IN (SELECT id FROM supplier_bills WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM supplier_bills WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM supplier_payments WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM payment_receipts WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM document_number_sequences WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM period_account_balances WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM accounting_periods WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM fiscal_years WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM posting_profile_versions
      WHERE posting_profile_id IN (SELECT id FROM posting_profiles WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM posting_profiles WHERE organization_id = ${orgId}`;

    // IPC chain (no organizationId directly on boqs/boq_versions)
    await prisma.$executeRaw`DELETE FROM interim_payment_certificate_items
      WHERE certificate_id IN (SELECT id FROM interim_payment_certificates WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM interim_payment_certificate_deductions
      WHERE certificate_id IN (SELECT id FROM interim_payment_certificates WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM interim_payment_certificates WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM interim_payment_applications WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM contracts WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM boq_nodes
      WHERE version_id IN (
        SELECT bv.id FROM boq_versions bv
        JOIN boqs b ON bv.boq_id = b.id
        JOIN projects p ON b.project_id = p.id
        WHERE p.organization_id = ${orgId}
      )`;

    await prisma.$executeRaw`DELETE FROM boq_versions
      WHERE boq_id IN (SELECT b.id FROM boqs b JOIN projects p ON b.project_id = p.id WHERE p.organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM boqs
      WHERE project_id IN (SELECT id FROM projects WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM projects WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM bank_accounts WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM account_versions
      WHERE account_id IN (SELECT id FROM accounts WHERE organization_id = ${orgId})`;

    await prisma.$executeRaw`DELETE FROM accounts WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM suppliers WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM clients WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM tax_codes WHERE organization_id = ${orgId}`;

    await prisma.$executeRaw`DELETE FROM organizations WHERE id = ${orgId}`;
  }
}
