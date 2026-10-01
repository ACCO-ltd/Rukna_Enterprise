import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountingConfigurationService } from '../../accounting-core/application/accounting-configuration.service.js';
import { buildFiscalYearPlan } from '../../accounting-core/domain/fiscal-calendar.js';
import {
  AccountingSetupRepository,
  type ExistingSetupRecord,
} from '../infrastructure/accounting-setup.repository.js';
import { planVatTaxCodes } from '../domain/setup-tax-codes.js';
import {
  CONSTRUCTION_TEMPLATE_ID,
  MAX_BANKS,
  OUTPUT_VAT_CODE,
  RETAINED_EARNINGS_CODE,
  bankAccountCode,
  resolveTemplate,
  type ResolvedTemplate,
  type TemplateAccount,
} from '../templates/construction.js';

// ── Contract shapes ───────────────────────────────────────────────────────────

export interface SetupTemplateView {
  templateId: typeof CONSTRUCTION_TEMPLATE_ID;
  version: string;
  accounts: Array<Pick<
    TemplateAccount,
    'code' | 'name' | 'accountClass' | 'accountSubtype' | 'normalBalance' | 'isHeading' | 'parentCode' | 'isControlAccount' | 'conditional'
  >>;
  postingProfiles: ResolvedTemplate['postingProfiles'];
}

export interface SetupStatusView {
  canInstall: boolean;
  reason: 'READY' | 'CHART_NOT_EMPTY' | 'PARTIAL_SETUP';
  /** Records found without a chart that block the one-step install (PARTIAL_SETUP). */
  existingRecords: ExistingSetupRecord[];
  accountCount: number;
  hasFiscalYear: boolean;
  hasPolicies: boolean;
  /**
   * ADR-041 — the default sales tax Finance has already configured. When set, setup keeps it and
   * creates no tax codes; the VAT question is not asked.
   */
  defaultSalesTax: { code: string; name: string; ratePercent: string } | null;
}

export interface InstallSetupInput {
  templateId: typeof CONSTRUCTION_TEMPLATE_ID;
  vat: { charged: boolean; ratePercent?: number };
  banks: Array<{ accountName: string; bankName: string; accountNumber?: string }>;
  fiscalYear: { year: number; startMonth?: number };
}

export interface InstallSetupResult {
  accountsCreated: number;
  postingProfilesCreated: number;
  fiscalYear: { id: string; name: string };
  bankAccountsCreated: number;
  taxCodesCreated: number;
}

export const ACCOUNTING_ALREADY_SET_UP = 'ACCOUNTING_ALREADY_SET_UP';
export const ACCOUNTING_SETUP_INVALID = 'ACCOUNTING_SETUP_INVALID';
export const ACCOUNTING_PARTIALLY_SET_UP = 'ACCOUNTING_PARTIALLY_SET_UP';

function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function earliestOf(a: Date, b: Date): Date {
  return a.getTime() <= b.getTime() ? a : b;
}

/** Placeholder when the user does not record an account number. Unique per bank (DB unique key). */
export function unrecordedAccountNumber(glCode: string): string {
  return `Not recorded (${glCode})`;
}

const alreadySetUp = () =>
  new ConflictException({
    errorCode: ACCOUNTING_ALREADY_SET_UP,
    message:
      'This organisation already has a chart of accounts. Continue with the individual setup screens.',
  });

const invalid = (message: string, details?: Record<string, unknown>) =>
  new BadRequestException({ errorCode: ACCOUNTING_SETUP_INVALID, message, ...(details ? { details } : {}) });

/**
 * ADR-040 — install everything an organisation needs to start posting, in one transaction, from a
 * versioned template. Allowed only while the chart is empty.
 */
@Injectable()
export class AccountingSetupService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: AccountingSetupRepository,
    private readonly config: AccountingConfigurationService,
  ) {}

  /** Preview: exactly what an install with these choices would create. */
  getTemplate(query: { vatRate?: number; banks?: number }): SetupTemplateView {
    const bankCount = Math.min(Math.max(query.banks ?? 0, 0), MAX_BANKS);
    const resolved = resolveTemplate({
      bankNames: Array.from({ length: bankCount }, (_, i) => `Bank ${i + 1}`),
    });
    return {
      templateId: resolved.templateId,
      version: resolved.version,
      accounts: resolved.accounts.map((a) => ({
        code: a.code,
        name: a.name,
        accountClass: a.accountClass,
        accountSubtype: a.accountSubtype,
        normalBalance: a.normalBalance,
        isHeading: a.isHeading,
        parentCode: a.parentCode,
        isControlAccount: a.isControlAccount,
        ...(a.conditional ? { conditional: a.conditional } : {}),
      })),
      postingProfiles: resolved.postingProfiles,
    };
  }

  async getStatus(identity: RequestIdentity): Promise<SetupStatusView> {
    const prisma = this.tenancy.getClient();
    const [facts, defaultTax] = await Promise.all([
      this.repo.getStatusFacts(prisma, identity.activeOrganizationId),
      this.repo.findDefaultOutputTax(prisma, identity.activeOrganizationId),
    ]);
    const reason: SetupStatusView['reason'] =
      facts.accountCount > 0 ? 'CHART_NOT_EMPTY' : facts.existingRecords.length > 0 ? 'PARTIAL_SETUP' : 'READY';
    return {
      canInstall: reason === 'READY',
      reason,
      existingRecords: facts.existingRecords,
      accountCount: facts.accountCount,
      hasFiscalYear: facts.hasFiscalYear,
      hasPolicies: facts.hasPolicies,
      defaultSalesTax: defaultTax
        ? { code: defaultTax.code, name: defaultTax.name, ratePercent: defaultTax.rate.toString() }
        : null,
    };
  }

  async install(identity: RequestIdentity, input: InstallSetupInput): Promise<InstallSetupResult> {
    const { activeOrganizationId: orgId, userId } = identity;
    this.validate(input);

    const prisma = this.tenancy.getClient();
    // Cheap early answer; re-checked under the lock inside the transaction.
    if ((await this.repo.countAccounts(prisma, orgId)) > 0) throw alreadySetUp();
    await this.assertNoPartialSetup(prisma, orgId);

    const startMonth = input.fiscalYear.startMonth ?? 1;
    const fyPlan = buildFiscalYearPlan(input.fiscalYear.year, startMonth);
    // Versions (accounts, profiles, tax codes) start at the fiscal-year start or today, whichever is
    // earlier: a chart installed for a future year must already be in force today, or every edit
    // and every posting dated before the year would find no version (review M2).
    const effectiveFrom = earliestOf(fyPlan.startDate, todayUtc());
    const vatRate = input.vat.charged ? input.vat.ratePercent! : null;
    const banks = input.banks.map((b) => ({
      accountName: b.accountName.trim(),
      bankName: b.bankName.trim(),
      accountNumber: b.accountNumber?.trim() || null,
    }));
    const template = resolveTemplate({ bankNames: banks.map((b) => b.accountName) });
    const taxCodes = vatRate !== null ? planVatTaxCodes(vatRate) : [];
    const currencyCode = await this.config.getBaseCurrency(orgId);

    try {
      return await prisma.$transaction(
        async (tx) => {
          await this.repo.lockOrganization(tx, orgId);
          if ((await this.repo.countAccounts(tx, orgId)) > 0) throw alreadySetUp();
          await this.assertNoPartialSetup(tx, orgId);

          await this.repo.upsertPolicies(tx, orgId, startMonth, userId);

          const idByCode = await this.repo.createAccounts(tx, orgId, template.accounts, effectiveFrom, userId);

          const postingProfilesCreated = await this.repo.createPostingProfiles(
            tx, orgId, template.postingProfiles, idByCode, effectiveFrom, userId,
          );

          // ADR-041 — tax Finance configured before the chart is kept as it is: no codes are created
          // and the VAT answer is not applied. Either way, sales codes get the Output VAT account.
          const taxAlreadyConfigured = (await this.repo.findDefaultOutputTax(tx, orgId)) !== null;
          const taxCodesCreated =
            taxCodes.length && !taxAlreadyConfigured
              ? await this.repo.createTaxCodes(
                  tx, orgId, taxCodes, { outputTaxAccountId: idByCode.get(OUTPUT_VAT_CODE)! }, effectiveFrom, userId,
                )
              : 0;
          await this.repo.linkOutputTaxAccount(tx, orgId, idByCode.get(OUTPUT_VAT_CODE)!);

          const fiscalYear = await this.repo.createFiscalYear(
            tx, orgId, fyPlan, idByCode.get(RETAINED_EARNINGS_CODE)!, userId,
          );

          const bankAccountsCreated = await this.repo.createBankAccounts(
            tx,
            orgId,
            banks.map((b, i) => {
              const glCode = bankAccountCode(i);
              return {
                accountName: b.accountName,
                bankName: b.bankName,
                accountNumber: b.accountNumber ?? unrecordedAccountNumber(glCode),
                glAccountId: idByCode.get(glCode)!,
              };
            }),
            currencyCode,
            userId,
          );

          await this.repo.ensureDocumentSequences(tx, orgId);

          const result: InstallSetupResult = {
            accountsCreated: idByCode.size,
            postingProfilesCreated,
            fiscalYear: { id: fiscalYear.id, name: fiscalYear.name },
            bankAccountsCreated,
            taxCodesCreated,
          };

          await this.repo.recordAudit(tx, {
            organizationId: orgId,
            userId,
            resourceId: fiscalYear.id,
            after: {
              templateId: template.templateId,
              templateVersion: template.version,
              vat: taxAlreadyConfigured
                ? { alreadyConfigured: true }
                : vatRate !== null
                  ? { charged: true, ratePercent: vatRate, taxCodes: taxCodes.map((t) => t.code) }
                  : { charged: false },
              banks: banks.map((b, i) => ({ glCode: bankAccountCode(i), accountName: b.accountName, bankName: b.bankName })),
              ...result,
              fiscalYear: { ...result.fiscalYear, startDate: fyPlan.startDate.toISOString().slice(0, 10) },
            },
          });

          return result;
        },
        { timeout: 120_000, maxWait: 20_000 },
      );
    } catch (err) {
      // A concurrent install that won the race surfaces as a unique violation on account code.
      // Only translated when the chart is now non-empty, so an unrelated unique violation still
      // surfaces as itself.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        (await this.repo.countAccounts(prisma, orgId)) > 0
      ) {
        throw alreadySetUp();
      }
      throw err;
    }
  }

  private async assertNoPartialSetup(client: Parameters<AccountingSetupRepository['findExistingRecords']>[0], orgId: string) {
    const existing = await this.repo.findExistingRecords(client, orgId);
    if (existing.length > 0) {
      throw new ConflictException({
        errorCode: ACCOUNTING_PARTIALLY_SET_UP,
        message:
          `This organisation has no chart of accounts but already has ${existing.map((e) => e.toLowerCase().replace(/_/g, ' ')).join(', ')}. ` +
          'The one-step setup would collide with them; finish the setup with the individual screens.',
        details: { existingRecords: existing },
      });
    }
  }

  private validate(input: InstallSetupInput): void {
    if (input.templateId !== CONSTRUCTION_TEMPLATE_ID) {
      throw invalid(`Unknown template "${String(input.templateId)}"`);
    }
    if (input.vat.charged) {
      const rate = input.vat.ratePercent;
      if (rate === undefined || rate === null || !(rate > 0) || rate > 100) {
        throw invalid('A VAT rate greater than 0 and at most 100 is required when VAT is charged', { field: 'vat.ratePercent' });
      }
    }
    if (input.banks.length > MAX_BANKS) {
      throw invalid(`At most ${MAX_BANKS} banks can be set up at once`, { field: 'banks' });
    }
    const seen = new Set<string>();
    for (const b of input.banks) {
      if (!b.accountName?.trim() || !b.bankName?.trim()) {
        throw invalid('Every bank needs an account name and a bank name', { field: 'banks' });
      }
      const number = b.accountNumber?.trim();
      if (number) {
        if (seen.has(number)) {
          throw invalid(`Bank account number ${number} is listed twice`, { field: 'banks', accountNumber: number });
        }
        seen.add(number);
      }
    }
    const { year, startMonth } = input.fiscalYear;
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw invalid('Fiscal year must be between 2000 and 2100', { field: 'fiscalYear.year' });
    }
    if (startMonth !== undefined && (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12)) {
      throw invalid('Fiscal year start month must be 1–12', { field: 'fiscalYear.startMonth' });
    }
  }
}
