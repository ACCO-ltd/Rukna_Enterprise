import { Injectable } from '@nestjs/common';
import { PERMISSIONS, type RequestIdentity } from '@erp/types';
import type {
  AccountingGuideResponse,
  GuideCycle,
  GuideStep,
  GuideStepStatus,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AccountingReadinessService } from './accounting-readiness.service.js';

const BASE = '/finance/accounting';

/**
 * Read-model behind the Accounting "Get started" hub and the cycle-status strip.
 *
 * Everything is derived live from real data, never a stored "onboarding done" flag: a checklist
 * that lies is worse than none. Setup reuses {@link AccountingReadinessService} (the same checks
 * the posting path dereferences). Daily/Month-end/Year-end are assembled from document counts and
 * period/fiscal-year state. Steps the signed-in user cannot perform are returned RESTRICTED so the
 * UI names who does them instead of showing a dead button — this is what makes the guide adapt to
 * whatever role split an organisation actually runs, without hard-coding one.
 */
@Injectable()
export class AccountingGuideService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly readiness: AccountingReadinessService,
  ) {}

  async getGuide(identity: RequestIdentity): Promise<AccountingGuideResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const today = new Date();

    const can = (perm: string) =>
      identity.permissions.includes('*') || identity.permissions.includes(perm);

    const readiness = await this.readiness.getReadiness(identity);
    const hasBlocker = (code: string) => readiness.blockers.some((b) => b.code === code);

    // Shared facts (a handful of cheap queries, run together).
    const [bankAccounts, openingJournal, currentPeriod, fiscalYear] = await Promise.all([
      prisma.bankAccount.count({ where: { organizationId: orgId } }),
      prisma.journalEntry.count({
        where: { organizationId: orgId, sourceDocumentType: 'OPENING_BALANCE' },
      }),
      prisma.accountingPeriod.findFirst({
        where: { organizationId: orgId, startDate: { lte: today }, endDate: { gte: today } },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true, status: true, endDate: true, fiscalYearId: true, periodNumber: true },
      }),
      prisma.fiscalYear.findFirst({
        where: { organizationId: orgId, startDate: { lte: today }, endDate: { gte: today } },
        select: { id: true, name: true, status: true },
      }),
    ]);

    const setup = this.buildSetup(readiness.ready, hasBlocker, bankAccounts, openingJournal, can);
    const daily = await this.buildDaily(prisma, orgId, readiness.ready, can);
    const monthEnd = await this.buildMonthEnd(prisma, orgId, readiness.ready, currentPeriod, can);
    const yearEnd = await this.buildYearEnd(prisma, orgId, readiness.ready, fiscalYear, can);

    return {
      ready: readiness.ready,
      cycles: [setup, daily, monthEnd, yearEnd],
      currentPeriod: currentPeriod
        ? { id: currentPeriod.id, name: currentPeriod.name, status: currentPeriod.status, endDate: currentPeriod.endDate.toISOString() }
        : null,
      fiscalYear: fiscalYear ?? null,
      checkedAt: today.toISOString(),
    };
  }

  // ── Setup ──────────────────────────────────────────────────────────────────
  private buildSetup(
    ready: boolean,
    hasBlocker: (code: string) => boolean,
    bankAccounts: number,
    openingJournal: number,
    can: (p: string) => boolean,
  ): GuideCycle {
    const manage = can(PERMISSIONS.accountingManage);
    const restrictedNote = 'Set up by an administrator (needs Manage accounting).';

    const raw: Array<{ key: string; label: string; detail: string; done: boolean; href: string | null; blocked?: boolean }> = [
      {
        key: 'chart-of-accounts',
        label: 'Chart of accounts',
        detail: 'Define the accounts and mark the control roles (AR, AP, revenue, VAT, bank, unapplied, supplier advance).',
        done: !hasBlocker('NO_CHART_OF_ACCOUNTS') && !hasBlocker('POSTING_ACCOUNT_NOT_CONFIGURED') && !hasBlocker('POSTING_ACCOUNT_AMBIGUOUS'),
        href: `${BASE}/chart-of-accounts`,
        blocked: hasBlocker('POSTING_ACCOUNT_AMBIGUOUS'),
      },
      {
        key: 'fiscal-year',
        label: 'Fiscal year & periods',
        detail: 'Create the fiscal year so there is an open period covering today to post into.',
        done: !hasBlocker('NO_OPEN_PERIOD'),
        href: `${BASE}/periods`,
      },
      {
        key: 'bank-accounts',
        label: 'Bank accounts',
        detail: 'Link each bank GL account to a bank account and add its signatories.',
        done: bankAccounts > 0,
        href: `${BASE}/bank-accounts`,
      },
      {
        key: 'posting-profiles',
        label: 'Expense posting profiles',
        detail: 'Supplier bill lines resolve their expense account through a posting profile. (Revenue categories pending confirmation.)',
        done: !hasBlocker('NO_POSTING_PROFILES'),
        href: null, // no dedicated screen yet — configured by an administrator
      },
      {
        key: 'document-numbering',
        label: 'Document numbering',
        detail: 'Number sequences for journals, invoices and bills. Normally seeded automatically.',
        done: !hasBlocker('NO_DOCUMENT_SEQUENCE'),
        href: null,
      },
      {
        key: 'opening-balances',
        label: 'Opening balances',
        detail: 'One-time: import the trial balance and open AR/AP items from your prior system. Skip if starting fresh.',
        done: openingJournal > 0,
        href: `${BASE}/opening-balance`,
      },
    ];

    let nextAssigned = false;
    const steps: GuideStep[] = raw.map((s) => {
      let status: GuideStepStatus;
      if (s.done) status = 'DONE';
      else if (!manage) status = 'RESTRICTED';
      else if (s.blocked) status = 'BLOCKED';
      else if (!nextAssigned) { status = 'NEXT'; nextAssigned = true; }
      else status = 'TODO';
      return {
        key: s.key,
        label: s.label,
        detail: !s.done && !manage ? `${s.detail} ${restrictedNote}` : s.detail,
        status,
        href: status === 'RESTRICTED' ? null : s.href,
      };
    });

    const done = steps.filter((s) => s.status === 'DONE').length;
    return {
      key: 'setup',
      title: 'First-time setup',
      summary: ready ? 'Complete — the ledger can accept postings' : `${done} of ${steps.length} done`,
      status: ready ? 'DONE' : 'IN_PROGRESS',
      steps,
    };
  }

  // ── Daily operations ─────────────────────────────────────────────────────────
  private async buildDaily(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    ready: boolean,
    can: (p: string) => boolean,
  ): Promise<GuideCycle> {
    if (!ready) {
      return {
        key: 'daily',
        title: 'Daily operations',
        summary: 'Finish setup first',
        status: 'LOCKED',
        steps: [],
      };
    }

    const [draftInvoices, draftBills, draftPayments, draftJournals] = await Promise.all([
      prisma.clientInvoice.count({
        where: {
          organizationId: orgId,
          OR: [{ documentStatus: 'DRAFT' }, { documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }],
        },
      }),
      prisma.supplierBill.count({
        where: {
          organizationId: orgId,
          OR: [{ documentStatus: { in: ['DRAFT', 'SUBMITTED'] } }, { documentStatus: 'APPROVED', postingStatus: 'NOT_POSTED' }],
        },
      }),
      prisma.supplierPayment.count({
        where: { organizationId: orgId, postingStatus: 'NOT_POSTED', documentStatus: { in: ['DRAFT', 'APPROVED', 'RELEASED'] } },
      }),
      prisma.journalEntry.count({
        where: { organizationId: orgId, sourceDocumentType: 'MANUAL_JOURNAL', status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
      }),
    ]);

    const queue = (key: string, label: string, detail: string, count: number, href: string, perm: string): GuideStep => {
      let status: GuideStepStatus;
      if (!can(perm)) status = 'RESTRICTED';
      else if (count > 0) status = 'ATTENTION';
      else status = 'DONE';
      return { key, label, detail, status, href: status === 'RESTRICTED' ? null : href, count: can(perm) ? count : undefined };
    };

    const steps: GuideStep[] = [
      queue('invoices', 'Bill clients', 'Raise, approve and post client invoices.', draftInvoices, `${BASE}/invoices`, PERMISSIONS.receivablesManage),
      queue('bills', 'Supplier bills', 'Enter, approve and post supplier bills.', draftBills, `${BASE}/bills`, PERMISSIONS.payablesManage),
      queue('payments', 'Supplier payments', 'Approve, release (dual-signatory) and post payments.', draftPayments, `${BASE}/payments`, PERMISSIONS.payablesManage),
      queue('journals', 'Manual journals', 'Create, submit, approve and post adjusting journals.', draftJournals, `${BASE}/journals`, PERMISSIONS.journalsManage),
    ];

    const waiting = steps.filter((s) => s.status === 'ATTENTION');
    const totalAwaiting = waiting.reduce((n, s) => n + (s.count ?? 0), 0);
    return {
      key: 'daily',
      title: 'Daily operations',
      summary: totalAwaiting > 0 ? `${totalAwaiting} item(s) await you` : 'Nothing awaiting you',
      status: waiting.length > 0 ? 'ATTENTION' : 'DONE',
      steps,
    };
  }

  // ── Month-end close ────────────────────────────────────────────────────────
  private async buildMonthEnd(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    ready: boolean,
    currentPeriod: { id: string; name: string; status: string } | null,
    can: (p: string) => boolean,
  ): Promise<GuideCycle> {
    if (!ready) {
      return { key: 'month_end', title: 'Month-end close', summary: 'Finish setup first', status: 'LOCKED', steps: [] };
    }

    const managePeriod = can(PERMISSIONS.periodsManage);
    const status = currentPeriod?.status ?? null;

    // Non-terminal journals in the current period block a lock.
    const unposted = currentPeriod
      ? await prisma.journalEntry.count({
          where: { organizationId: orgId, accountingPeriodId: currentPeriod.id, status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] } },
        })
      : 0;

    const restricted = (href: string | null): { s: GuideStepStatus; href: string | null } =>
      managePeriod ? { s: 'TODO', href } : { s: 'RESTRICTED', href: null };

    const steps: GuideStep[] = [
      {
        key: 'post-everything',
        label: 'Post everything for the month',
        detail: unposted > 0 ? `${unposted} draft/unposted journal(s) in ${currentPeriod?.name}.` : 'All journals in the current period are posted.',
        status: unposted > 0 ? 'ATTENTION' : 'DONE',
        href: `${BASE}/journals`,
        count: unposted > 0 ? unposted : undefined,
      },
      {
        key: 'reconcile',
        label: 'Reconcile AR/AP control accounts',
        detail: 'Check GL control balances against the subledgers before closing.',
        status: 'TODO',
        href: `${BASE}/reconciliation`,
      },
      {
        key: 'lock-period',
        label: 'Lock the period',
        detail: 'Locking stops ordinary postings; only closing adjustments remain.',
        status: status === 'OPEN' || status === 'REOPENED' ? (managePeriod ? (unposted === 0 ? 'NEXT' : 'TODO') : 'RESTRICTED') : (status === 'LOCKED' || status === 'CLOSED' ? 'DONE' : restricted(`${BASE}/periods`).s),
        href: managePeriod ? `${BASE}/periods` : null,
      },
      {
        key: 'close-period',
        label: 'Close the period',
        detail: 'Run the pre-flight close-gate, then close. The month is frozen and snapshotted.',
        status: status === 'LOCKED' ? (managePeriod ? 'NEXT' : 'RESTRICTED') : status === 'CLOSED' ? 'DONE' : (managePeriod ? 'TODO' : 'RESTRICTED'),
        href: managePeriod ? `${BASE}/periods` : null,
      },
      {
        key: 'read-reports',
        label: 'Review the statements',
        detail: 'Trial balance, P&L and balance sheet for the closed month.',
        status: 'TODO',
        href: `${BASE}/trial-balance`,
      },
    ];

    const cycleStatus: GuideCycle['status'] =
      status === 'CLOSED' ? 'DONE' : unposted > 0 ? 'ATTENTION' : 'IN_PROGRESS';
    return {
      key: 'month_end',
      title: 'Month-end close',
      summary: currentPeriod ? `${currentPeriod.name} — ${status?.toLowerCase()}` : 'No current period',
      status: cycleStatus,
      steps,
    };
  }

  // ── Year-end close ───────────────────────────────────────────────────────────
  private async buildYearEnd(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    ready: boolean,
    fiscalYear: { id: string; name: string; status: string } | null,
    can: (p: string) => boolean,
  ): Promise<GuideCycle> {
    if (!ready || !fiscalYear) {
      return { key: 'year_end', title: 'Year-end close', summary: ready ? 'No current fiscal year' : 'Finish setup first', status: 'LOCKED', steps: [] };
    }

    const managePeriod = can(PERMISSIONS.periodsManage);
    const periods = await prisma.accountingPeriod.findMany({
      where: { organizationId: orgId, fiscalYearId: fiscalYear.id },
      select: { periodNumber: true, status: true },
      orderBy: { periodNumber: 'asc' },
    });
    const priorOpen = periods.filter((p) => p.periodNumber < 12 && p.status !== 'CLOSED').length;
    const period12 = periods.find((p) => p.periodNumber === 12);
    const fyClosed = fiscalYear.status === 'CLOSED';

    const steps: GuideStep[] = [
      {
        key: 'close-months',
        label: 'Close periods 1–11',
        detail: priorOpen > 0 ? `${priorOpen} earlier period(s) not yet closed.` : 'All earlier periods are closed.',
        status: priorOpen > 0 ? 'ATTENTION' : 'DONE',
        href: `${BASE}/periods`,
      },
      {
        key: 'lock-p12',
        label: 'Lock period 12',
        detail: 'The final period must be LOCKED before year-end close.',
        status: fyClosed ? 'DONE' : period12?.status === 'LOCKED' || period12?.status === 'CLOSED' ? 'DONE' : managePeriod ? 'TODO' : 'RESTRICTED',
        href: managePeriod ? `${BASE}/periods` : null,
      },
      {
        key: 'year-end-close',
        label: 'Run year-end close',
        detail: 'Rolls the P&L into retained earnings, snapshots period 12 and closes the year.',
        status: fyClosed ? 'DONE' : priorOpen === 0 && period12?.status === 'LOCKED' ? (managePeriod ? 'NEXT' : 'RESTRICTED') : managePeriod ? 'TODO' : 'RESTRICTED',
        href: managePeriod ? `${BASE}/periods` : null,
      },
    ];

    return {
      key: 'year_end',
      title: 'Year-end close',
      summary: fyClosed ? `${fiscalYear.name} — closed` : `${fiscalYear.name} — open`,
      status: fyClosed ? 'DONE' : priorOpen === 0 && period12?.status === 'LOCKED' ? 'READY' : 'IN_PROGRESS',
      steps,
    };
  }
}
