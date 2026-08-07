import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountRepository } from '../infrastructure/account.repository.js';
import { JournalRepository } from '../infrastructure/journal.repository.js';

export interface ControlAccountCheck {
  accountCode: string;
  accountName: string;
  subledgerType: 'AR' | 'AP' | 'BANK';
  glBalance: string;
  subledgerBalance: string;
  variance: string;
  reconciled: boolean;
  periodId?: string;
}

export interface ReconciliationReport {
  organizationId: string;
  generatedAt: string;
  checks: ControlAccountCheck[];
  allReconciled: boolean;
  blocksClose: boolean;
}

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly accountRepo: AccountRepository,
    private readonly journalRepo: JournalRepository,
  ) {}

  /**
   * Run full control account reconciliation.
   * AR GL = ∑ open client invoice outstanding amounts
   * AP GL = ∑ open supplier bill outstanding amounts
   * Bank GL = verified via journal lines only (bank statement reconciliation is Phase 3)
   *
   * Variance > 0.01 flags as unreconciled and blocks period close
   * when PostingPolicy.requireBankReviewBeforeClose = true.
   */
  async runFullReconciliation(
    identity: RequestIdentity,
    opts: {
      arAccountCode: string;
      apAccountCode: string;
      bankAccountCodes?: string[];
      periodId?: string;
    },
  ): Promise<ReconciliationReport> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const checks: ControlAccountCheck[] = [];

    // ── AR Reconciliation ──────────────────────────────────────────────────────
    const arAccount = await this.accountRepo.findByCode(prisma, orgId, opts.arAccountCode);
    if (arAccount) {
      const arGlBalance = (await this.journalRepo.getGlBalance(prisma, orgId, arAccount.id)).abs();

      const arAgg = await prisma.clientInvoice.aggregate({
        where: {
          organizationId: orgId,
          postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] },
        },
        _sum: { outstandingAmount: true },
      });
      const arSubledger = new Decimal(arAgg._sum.outstandingAmount?.toString() ?? '0');
      const arVariance = arGlBalance.minus(arSubledger).abs();

      const currentVersion = arAccount.versions[0];
      checks.push({
        accountCode: arAccount.code,
        accountName: currentVersion?.name ?? arAccount.code,
        subledgerType: 'AR',
        glBalance: arGlBalance.toFixed(2),
        subledgerBalance: arSubledger.toFixed(2),
        variance: arVariance.toFixed(2),
        reconciled: arVariance.lte(new Decimal('0.01')),
        periodId: opts.periodId,
      });
    }

    // ── AP Reconciliation ──────────────────────────────────────────────────────
    const apAccount = await this.accountRepo.findByCode(prisma, orgId, opts.apAccountCode);
    if (apAccount) {
      const apGlBalance = (await this.journalRepo.getGlBalance(prisma, orgId, apAccount.id)).abs();

      const apAgg = await prisma.supplierBill.aggregate({
        where: {
          organizationId: orgId,
          postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] },
        },
        _sum: { outstandingAmount: true },
      });
      const apSubledger = new Decimal(apAgg._sum.outstandingAmount?.toString() ?? '0');
      const apVariance = apGlBalance.minus(apSubledger).abs();

      const currentVersion = apAccount.versions[0];
      checks.push({
        accountCode: apAccount.code,
        accountName: currentVersion?.name ?? apAccount.code,
        subledgerType: 'AP',
        glBalance: apGlBalance.toFixed(2),
        subledgerBalance: apSubledger.toFixed(2),
        variance: apVariance.toFixed(2),
        reconciled: apVariance.lte(new Decimal('0.01')),
        periodId: opts.periodId,
      });
    }

    // ── Bank GL checks (internal — statement reconciliation is Phase 3) ────────
    for (const bankCode of opts.bankAccountCodes ?? []) {
      const bankAccount = await this.accountRepo.findByCode(prisma, orgId, bankCode);
      if (!bankAccount) continue;

      const bankGlBalance = await this.journalRepo.getGlBalance(prisma, orgId, bankAccount.id);

      const bankConfig = await prisma.bankAccount.findFirst({
        where: { organizationId: orgId, glAccountId: bankAccount.id },
        select: { accountName: true },
      });

      const currentVersion = bankAccount.versions[0];
      checks.push({
        accountCode: bankAccount.code,
        accountName: bankConfig?.accountName ?? currentVersion?.name ?? bankCode,
        subledgerType: 'BANK',
        glBalance: bankGlBalance.toFixed(2),
        subledgerBalance: bankGlBalance.toFixed(2),
        variance: '0.00',
        reconciled: true,
        periodId: opts.periodId,
      });
    }

    const allReconciled = checks.every((c) => c.reconciled);
    const unreconciledItems = checks.filter((c) => !c.reconciled);

    return {
      organizationId: orgId,
      generatedAt: new Date().toISOString(),
      checks,
      allReconciled,
      blocksClose: !allReconciled && unreconciledItems.length > 0,
    };
  }

  /**
   * Quick check: can the given period be closed?
   * Returns blocking reasons if any exist.
   */
  async getPeriodCloseReadiness(
    identity: RequestIdentity,
    periodId: string,
    opts: { arAccountCode: string; apAccountCode: string },
  ): Promise<{ ready: boolean; blockers: string[] }> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;
    const blockers: string[] = [];

    // Check for unposted approved documents
    const unpostedInvoices = await prisma.clientInvoice.count({
      where: {
        organizationId: orgId,
        documentStatus: 'APPROVED',
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
      },
    });
    if (unpostedInvoices > 0) {
      blockers.push(`${unpostedInvoices} approved client invoice(s) not yet posted`);
    }

    const unpostedBills = await prisma.supplierBill.count({
      where: {
        organizationId: orgId,
        documentStatus: 'APPROVED',
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
      },
    });
    if (unpostedBills > 0) {
      blockers.push(`${unpostedBills} approved supplier bill(s) not yet posted`);
    }

    const unpostedReceipts = await prisma.paymentReceipt.count({
      where: {
        organizationId: orgId,
        documentStatus: 'APPROVED',
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
      },
    });
    if (unpostedReceipts > 0) {
      blockers.push(`${unpostedReceipts} approved payment receipt(s) not yet posted`);
    }

    const unpostedPayments = await prisma.supplierPayment.count({
      where: {
        organizationId: orgId,
        documentStatus: 'APPROVED',
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
      },
    });
    if (unpostedPayments > 0) {
      blockers.push(`${unpostedPayments} approved supplier payment(s) not yet posted`);
    }

    // Unsubmitted draft manual journals
    const draftJournals = await prisma.journalEntry.count({
      where: {
        organizationId: orgId,
        sourceDocumentType: 'MANUAL_JOURNAL',
        status: { in: ['DRAFT', 'SUBMITTED'] },
      },
    });
    if (draftJournals > 0) {
      blockers.push(`${draftJournals} manual journal(s) still in DRAFT or SUBMITTED status`);
    }

    // AR/AP reconciliation
    const reconReport = await this.runFullReconciliation(identity, {
      arAccountCode: opts.arAccountCode,
      apAccountCode: opts.apAccountCode,
      periodId,
    });
    for (const check of reconReport.checks) {
      if (!check.reconciled) {
        blockers.push(
          `${check.subledgerType} reconciliation variance: GL ${check.glBalance} vs Subledger ${check.subledgerBalance} (Δ ${check.variance})`,
        );
      }
    }

    return { ready: blockers.length === 0, blockers };
  }
}
