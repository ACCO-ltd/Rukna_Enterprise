import { Injectable } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';

import { AccountingConfigurationRepository } from '../../accounting-core/infrastructure/accounting-configuration.repository.js';
import { BankAccountRepository } from '../../accounting-core/infrastructure/bank-account.repository.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { FiscalYearRepository } from '../../accounting-core/infrastructure/fiscal-year.repository.js';
import type { FiscalYearPlan } from '../../accounting-core/domain/fiscal-calendar.js';
import type { TemplateAccount, TemplatePostingProfile } from '../templates/construction.js';
import type { SetupTaxCodePlan } from '../domain/setup-tax-codes.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type ExistingSetupRecord = 'TAX_CODES' | 'POSTING_PROFILES' | 'BANK_ACCOUNTS' | 'FISCAL_YEARS';

/** Document sequences an organisation needs to number its accounting documents (seed + credit notes). */
export const SETUP_DOCUMENT_SEQUENCES: ReadonlyArray<{ documentType: string; prefix: string }> = [
  { documentType: 'JOURNAL_ENTRY', prefix: 'JE-' },
  { documentType: 'CLIENT_INVOICE', prefix: 'INV-' },
  { documentType: 'PAYMENT_RECEIPT', prefix: 'RCP-' },
  { documentType: 'SUPPLIER_BILL', prefix: 'BILL-' },
  { documentType: 'SUPPLIER_PAYMENT', prefix: 'PMT-' },
  { documentType: 'CREDIT_NOTE', prefix: 'CN-' },
];

/**
 * ADR-040 — every write the one-step accounting setup makes. Each method takes the transaction
 * client the service opened, so the install commits or rolls back as one unit.
 */
@Injectable()
export class AccountingSetupRepository {
  constructor(
    private readonly configRepo: AccountingConfigurationRepository,
    private readonly fiscalYearRepo: FiscalYearRepository,
    private readonly bankAccountRepo: BankAccountRepository,
    private readonly sequenceRepo: DocumentSequenceRepository,
  ) {}

  // ── Reads ─────────────────────────────────────────────────────────────────

  countAccounts(prisma: TenantPrisma, organizationId: string): Promise<number> {
    return prisma.account.count({ where: { organizationId } });
  }

  /**
   * Accounting records that can exist without a chart and would collide with what setup writes
   * (unique profile codes, bank account numbers, fiscal-year names and dates). Document sequences
   * are not listed: setup reuses an existing sequence rather than creating a second one. Tax codes
   * are not listed either (ADR-041): Finance configures tax before the chart is signed off, and
   * setup keeps what it finds.
   */
  async findExistingRecords(prisma: TenantPrisma, organizationId: string): Promise<ExistingSetupRecord[]> {
    const [profiles, banks, fiscalYears] = await Promise.all([
      prisma.postingProfile.count({ where: { organizationId } }),
      prisma.bankAccount.count({ where: { organizationId } }),
      prisma.fiscalYear.count({ where: { organizationId } }),
    ]);
    const found: ExistingSetupRecord[] = [];
    if (profiles) found.push('POSTING_PROFILES');
    if (banks) found.push('BANK_ACCOUNTS');
    if (fiscalYears) found.push('FISCAL_YEARS');
    return found;
  }

  async getStatusFacts(prisma: TenantPrisma, organizationId: string) {
    const [accountCount, fiscalYears, calendar, posting, tax, numbering, dimension, banking] = await Promise.all([
      prisma.account.count({ where: { organizationId } }),
      prisma.fiscalYear.count({ where: { organizationId } }),
      this.configRepo.getFiscalCalendarPolicy(prisma, organizationId),
      this.configRepo.getPostingPolicy(prisma, organizationId),
      this.configRepo.getTaxPolicy(prisma, organizationId),
      this.configRepo.getNumberingPolicy(prisma, organizationId),
      this.configRepo.getDimensionPolicy(prisma, organizationId),
      this.configRepo.getBankingPolicy(prisma, organizationId),
    ]);
    return {
      accountCount,
      existingRecords: await this.findExistingRecords(prisma, organizationId),
      hasFiscalYear: fiscalYears > 0,
      hasPolicies: [calendar, posting, tax, numbering, dimension, banking].every((p) => p !== null),
    };
  }

  // ── Writes (inside the install transaction) ─────────────────────────────────

  /**
   * Serialise concurrent installs for one organisation. Transaction-scoped: released at commit
   * or rollback. The caller re-checks the chart is empty after taking it.
   */
  async lockOrganization(tx: TenantPrisma, organizationId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`accounting-setup:${organizationId}`}))`;
  }

  /** The six policy rows, as `prisma/seeds/accounting-phase1.seed.ts` writes them. */
  async upsertPolicies(tx: TenantPrisma, organizationId: string, fiscalYearStartMonth: number, updatedBy: string) {
    await this.configRepo.upsertFiscalCalendarPolicy(tx, organizationId, {
      fiscalYearStartMonth,
      fiscalYearStartDay: 1,
      useAdjustmentPeriods: false,
      updatedBy,
    });
    await this.configRepo.upsertTaxPolicy(tx, organizationId, { updatedBy });
    await this.configRepo.upsertNumberingPolicy(tx, organizationId, { numberingScope: 'CONTINUOUS', updatedBy });
    await this.configRepo.upsertPostingPolicy(tx, organizationId, {
      requireFourEyesOnJournals: true,
      draftJournalsBlockPeriodClose: true,
      enforceControlAccountAtDb: true,
      updatedBy,
    });
    await this.configRepo.upsertDimensionPolicy(tx, organizationId, {
      projectDimensionDefault: 'REQUIRED',
      departmentDimensionDefault: 'REQUIRED',
      costCenterDimensionDefault: 'OPTIONAL',
      updatedBy,
    });
    await this.configRepo.upsertBankingPolicy(tx, organizationId, {
      requireBankAccountForReceipts: true,
      requireBankAccountForPayments: true,
      requireBankReviewBeforeClose: false,
      updatedBy,
    });
  }

  /**
   * Creates the accounts in the order given (the template is parent-first) and returns
   * code → id. A parent that is not yet created is a template defect and throws.
   */
  async createAccounts(
    tx: TenantPrisma,
    organizationId: string,
    accounts: TemplateAccount[],
    effectiveFrom: Date,
    createdBy: string,
  ): Promise<Map<string, string>> {
    const idByCode = new Map<string, string>();
    for (const a of accounts) {
      let parentAccountId: string | undefined;
      if (a.parentCode) {
        parentAccountId = idByCode.get(a.parentCode);
        if (!parentAccountId) throw new Error(`Template defect: parent ${a.parentCode} of ${a.code} not created first`);
      }
      const created = await tx.account.create({
        data: {
          organizationId,
          code: a.code,
          normalBalance: a.normalBalance,
          status: 'ACTIVE',
          createdBy,
          versions: {
            create: {
              versionNumber: 1,
              name: a.name,
              parentAccountId,
              accountClass: a.accountClass,
              accountSubtype: a.accountSubtype,
              isPostingAllowed: a.isPostingAllowed,
              isControlAccount: a.isControlAccount,
              controlledSubledgerType: a.controlledSubledgerType ?? undefined,
              controlPostingPolicy: a.controlPostingPolicy,
              effectiveFrom,
              changedBy: createdBy,
              changeReason: 'Accounting setup (ADR-040)',
            },
          },
        },
        select: { id: true },
      });
      idByCode.set(a.code, created.id);
    }
    return idByCode;
  }

  async createPostingProfiles(
    tx: TenantPrisma,
    organizationId: string,
    profiles: TemplatePostingProfile[],
    accountIdByCode: Map<string, string>,
    effectiveFrom: Date,
    createdBy: string,
  ): Promise<number> {
    for (const p of profiles) {
      const accountId = accountIdByCode.get(p.accountCode);
      if (!accountId) throw new Error(`Template defect: profile ${p.code} targets missing account ${p.accountCode}`);
      await tx.postingProfile.create({
        data: {
          organizationId,
          code: p.code,
          status: 'ACTIVE',
          createdBy,
          versions: {
            create: { versionNumber: 1, name: p.name, accountId, effectiveFrom, changedBy: createdBy },
          },
        },
        select: { id: true },
      });
    }
    return profiles.length;
  }

  async createTaxCodes(
    tx: TenantPrisma,
    organizationId: string,
    codes: SetupTaxCodePlan[],
    links: { outputTaxAccountId: string },
    effectiveFrom: Date,
    createdBy: string,
  ): Promise<number> {
    let outputId: string | null = null;
    let inputId: string | null = null;
    let created = 0;
    for (const c of codes) {
      // A code Finance already created under this name is kept, not duplicated (ADR-041).
      const existing = await tx.taxCode.findUnique({
        where: { organizationId_code: { organizationId, code: c.code } },
        select: { id: true, status: true },
      });
      if (existing) {
        // Setup is about to make it the default: an inactive one is brought back into use.
        if (existing.status !== 'ACTIVE') {
          await tx.taxCode.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } });
        }
        if (c.direction === 'OUTPUT') outputId = existing.id;
        else inputId = existing.id;
        continue;
      }
      created += 1;
      const row = await tx.taxCode.create({
        data: {
          organizationId,
          code: c.code,
          name: c.name,
          rate: c.rate,
          taxType: 'VAT',
          direction: c.direction,
          recoveryMethod: c.recoveryMethod,
          // ACC-TAX-001: non-recoverable input VAT carries no input-tax account.
          outputTaxAccountId: c.direction === 'OUTPUT' ? links.outputTaxAccountId : null,
          effectiveFrom,
          status: 'ACTIVE',
          createdBy,
        },
        select: { id: true },
      });
      if (c.direction === 'OUTPUT') outputId = row.id;
      else inputId = row.id;
    }
    await this.configRepo.upsertTaxPolicy(tx, organizationId, {
      defaultOutputTaxCodeId: outputId,
      defaultInputTaxCodeId: inputId,
      updatedBy: createdBy,
    });
    return created;
  }
  /** ADR-041 — whether Finance has already set a default sales tax code. */
  async findDefaultOutputTax(prisma: TenantPrisma, organizationId: string) {
    const policy = await prisma.taxPolicy.findUnique({
      where: { organizationId },
      select: { defaultOutputTaxCodeId: true },
    });
    if (!policy?.defaultOutputTaxCodeId) return null;
    return prisma.taxCode.findFirst({
      where: { id: policy.defaultOutputTaxCodeId, organizationId },
      select: { id: true, code: true, name: true, rate: true },
    });
  }

  /** Sales tax codes created before the chart existed get the new Output VAT account. */
  async linkOutputTaxAccount(tx: TenantPrisma, organizationId: string, outputTaxAccountId: string) {
    await tx.taxCode.updateMany({
      where: { organizationId, direction: 'OUTPUT', outputTaxAccountId: null },
      data: { outputTaxAccountId },
    });
  }


  createFiscalYear(
    tx: TenantPrisma,
    organizationId: string,
    plan: FiscalYearPlan,
    retainedEarningsAccountId: string,
    createdBy: string,
  ) {
    return this.fiscalYearRepo.createWithPeriods(tx, {
      organizationId,
      name: plan.name,
      startDate: plan.startDate,
      endDate: plan.endDate,
      retainedEarningsAccountId,
      createdBy,
      // Its twelve periods are OPEN and it is the year in use; year-end close requires OPEN.
      status: 'OPEN',
      periods: plan.periods.map((p) => ({ ...p, organizationId })),
    });
  }

  async createBankAccounts(
    tx: TenantPrisma,
    organizationId: string,
    banks: Array<{ accountName: string; bankName: string; accountNumber: string; glAccountId: string }>,
    currencyCode: string,
    createdBy: string,
  ): Promise<number> {
    for (const b of banks) {
      await this.bankAccountRepo.create(tx, {
        organizationId,
        accountName: b.accountName,
        bankName: b.bankName,
        accountNumber: b.accountNumber,
        currencyCode,
        glAccountId: b.glAccountId,
        allowsReceipts: true,
        allowsPayments: true,
        createdBy,
      });
    }
    return banks.length;
  }

  async ensureDocumentSequences(tx: TenantPrisma, organizationId: string): Promise<void> {
    for (const s of SETUP_DOCUMENT_SEQUENCES) {
      await this.sequenceRepo.ensureSequence(tx as never, organizationId, s.documentType, s.prefix);
    }
  }

  async recordAudit(
    tx: TenantPrisma,
    data: { organizationId: string; userId: string; resourceId: string; after: Record<string, unknown> },
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        userId: data.userId,
        orgId: data.organizationId,
        action: 'ACCOUNTING_SETUP_INSTALLED',
        resource: 'accounting-setup',
        resourceId: data.resourceId,
        after: data.after as Prisma.InputJsonValue,
        sourceCommand: 'accounting.setup.install',
      },
    });
  }
}
