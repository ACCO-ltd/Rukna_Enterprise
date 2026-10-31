import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountRepository } from '../infrastructure/account.repository.js';
import { JournalRepository } from '../infrastructure/journal.repository.js';
import { pendingPaymentHoldsTotal } from '../../accounts-payable/infrastructure/pending-payment-holds.repository.js';

export interface ControlAccountCheck {
  accountId: string;
  accountCode: string;
  accountName: string;
  subledgerType: 'AR' | 'AP';
  /** On the account's own side: receivables in debit, payables in credit. A negative is wrong. */
  glBalance: string;
  subledgerBalance: string;
  /** Books less documents, signed. */
  variance: string;
  reconciled: boolean;
  /** Open invoices or bills making up the documents' side. */
  documentCount: number;
}

export interface ReconciliationReport {
  organizationId: string;
  generatedAt: string;
  checks: ControlAccountCheck[];
  allReconciled: boolean;
  blocksClose: boolean;
}

const TOLERANCE = new Decimal('0.01');

@Injectable()
export class ReconciliationService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly accountRepo: AccountRepository,
    private readonly journalRepo: JournalRepository,
  ) {}

  /**
   * GL-L — does each control account agree with the documents behind it, today?
   *   AR: the receivable control accounts against what open client invoices still owe
   *   AP: the payable control accounts against what open bills still owe (plus bills held by an
   *       unposted payment, which are still owed until it posts)
   * Balances keep their sign: a receivable in credit is a fault, not a match. The control accounts
   * are found from the chart; codes may still be given to name them.
   */
  async runFullReconciliation(
    identity: RequestIdentity,
    opts: { arAccountCode?: string; apAccountCode?: string } = {},
  ): Promise<ReconciliationReport> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;
    const checks: ControlAccountCheck[] = [];

    const controls = async (code: string | undefined, kind: 'ACCOUNTS_RECEIVABLE' | 'ACCOUNTS_PAYABLE') => {
      if (code) {
        const one = await this.accountRepo.findByCode(prisma, orgId, code);
        return one ? [one] : [];
      }
      const all = (await this.accountRepo.findAll(prisma, orgId)).filter((a) => a.status === 'ACTIVE' && a.versions[0]?.isControlAccount);
      // The account marked as controlling the subledger; failing that, a control account of the subtype.
      const marked = all.filter((a) => a.versions[0]?.controlledSubledgerType === kind);
      return marked.length > 0 ? marked : all.filter((a) => a.versions[0]?.accountSubtype === kind);
    };

    const check = async (
      accounts: Awaited<ReturnType<typeof controls>>,
      type: 'AR' | 'AP',
      documents: { total: Decimal; count: number },
    ) => {
      for (const account of accounts) {
        const net = await this.journalRepo.getGlBalance(prisma, orgId, account.id);
        const gl = type === 'AR' ? net : net.negated();
        // With more than one control account of a kind, the documents are compared once, against the first.
        const docs = account === accounts[0] ? documents : { total: new Decimal(0), count: 0 };
        const variance = gl.minus(docs.total);
        checks.push({
          accountId: account.id,
          accountCode: account.code,
          accountName: account.versions[0]?.name ?? account.code,
          subledgerType: type,
          glBalance: gl.toFixed(2),
          subledgerBalance: docs.total.toFixed(2),
          variance: variance.toFixed(2),
          reconciled: variance.abs().lte(TOLERANCE),
          documentCount: docs.count,
        });
      }
    };

    const ar = await prisma.clientInvoice.aggregate({
      where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] }, outstandingAmount: { not: 0 } },
      _sum: { outstandingAmount: true },
      _count: true,
    });
    await check(await controls(opts.arAccountCode, 'ACCOUNTS_RECEIVABLE'), 'AR', {
      total: new Decimal(ar._sum.outstandingAmount?.toString() ?? '0'),
      count: ar._count,
    });

    const ap = await prisma.supplierBill.aggregate({
      where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] }, outstandingAmount: { not: 0 } },
      _sum: { outstandingAmount: true },
      _count: true,
    });
    // AP-1 — a bill held by an unposted payment is still owed: the ledger moves when it posts.
    await check(await controls(opts.apAccountCode, 'ACCOUNTS_PAYABLE'), 'AP', {
      total: new Decimal(ap._sum.outstandingAmount?.toString() ?? '0').plus(await pendingPaymentHoldsTotal(prisma as never, orgId)),
      count: ap._count,
    });

    const allReconciled = checks.every((c) => c.reconciled);
    return {
      organizationId: orgId,
      generatedAt: new Date().toISOString(),
      checks,
      allReconciled,
      blocksClose: !allReconciled,
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
