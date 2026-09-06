import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type FinanceActivityRow,
  type FinanceAttentionItem,
  type FinanceControlStatus,
  type ProjectAccountingPosition,
  type ProjectFinanceOverviewResponse,
  type ProjectFinancePeriod,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProjectProcurementService } from '../../../procurement/project-procurement/application/project-procurement.service.js';
import { AccountingReadinessService } from '../../accounting-core/application/accounting-readiness.service.js';
import { ProjectCostReconciliationService } from './project-cost-reconciliation.service.js';
import { ProjectFinancialPositionRepository } from '../infrastructure/project-financial-position.repository.js';

/** A period closing inside this many days is worth flagging before it does. */
const PERIOD_CLOSING_WARNING_DAYS = 14;
const ACTIVITY_LIMIT = 8;

/**
 * Everything the Finance Overview shows, in one read.
 *
 * Two rules shape this service.
 *
 * **It computes no figure that another read model already owns.** The cost position and the cost
 * areas come from the same `ProjectProcurementService.getCost` rollup that Cost Control renders,
 * so the two screens cannot disagree about what the project has committed. The reconciliation
 * comes from `ProjectCostReconciliationService`, the setup state from
 * `AccountingReadinessService`. A second path to the same number is a second answer as soon as
 * one of them misses a case.
 *
 * **Every control state is a measured fact.** "Reconciled", "Ready", "closes in 9 days" are
 * computed here from data, not asserted by the browser from a heuristic. That matters more than
 * it sounds: the whole point of the control strip is to tell a reader whether the money figures
 * above it can be trusted, and a status the frontend invented would defeat it.
 */
@Injectable()
export class ProjectFinanceOverviewService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly procurement: ProjectProcurementService,
    private readonly reconciliation: ProjectCostReconciliationService,
    private readonly readiness: AccountingReadinessService,
    private readonly repo: ProjectFinancialPositionRepository,
  ) {}

  async getOverview(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProjectFinanceOverviewResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);

    const [cost, reconciliation, readiness, budgets, period, revenue, unpostedBills] =
      await Promise.all([
        this.procurement.getCost(identity, projectId),
        this.reconciliation.getForProject(identity, projectId),
        this.readiness.getReadiness(identity),
        this.repo.findBudgetVersions(prisma, orgId, projectId),
        this.repo.findCurrentPeriod(prisma, orgId),
        this.repo.sumPostedRevenue(prisma, orgId, projectId),
        this.repo.countApprovedUnpostedBills(prisma, orgId, projectId),
      ]);

    const accountingPosition = this.buildAccountingPosition(
      readiness.ready,
      readiness.blockers,
      revenue,
      new Decimal(reconciliation.glTotalProjectCost),
      mayViewFinancials,
    );

    const baselined = budgets.find((b) => b.status === 'BASELINED') ?? null;
    const draft = budgets.find((b) => b.status === 'DRAFT') ?? null;
    const periodInfo = this.buildPeriod(period);

    const attention = this.buildAttention({
      reconciliation,
      readiness,
      baselined: baselined !== null,
      draft,
      periodInfo,
      unpostedBills,
      projectId,
    });

    return {
      projectId,
      currency: cost.position.currency,
      financialsVisible: mayViewFinancials,
      costPosition: cost.position,
      accountingPosition,
      controls: {
        reconciliation: this.reconciliationStatus(reconciliation),
        accountingSetup: this.setupStatus(readiness),
        costBudget: this.budgetStatus(baselined, draft),
        period: this.periodStatus(periodInfo),
      },
      reconciliation,
      period: periodInfo,
      budget: {
        versionNumber: baselined?.versionNumber ?? draft?.versionNumber ?? null,
        status: baselined ? 'BASELINED' : draft ? 'WORKING' : null,
        baselinedAt: baselined?.baselinedAt?.toISOString() ?? null,
        baselinedBy: baselined?.baselinedBy ?? null,
        hasWorkingDraft: draft !== null,
      },
      // Top-level areas only — the expandable hierarchy belongs to Cost Control, and rendering it
      // twice would be two answers to "where did the money go".
      costByArea: cost.byBoq.filter((row) => row.depth === 0),
      attention,
      activity: await this.buildActivity(prisma, orgId, projectId, mayViewFinancials),
      asOf: cost.asOf,
    };
  }

  /**
   * Posted revenue and cost for the project.
   *
   * When the ledger cannot accept a posting at all, every figure is null rather than zero: a
   * project whose accounting was never configured has not earned nothing, and the two states
   * must not look the same on screen.
   */
  private buildAccountingPosition(
    ready: boolean,
    blockers: ProjectAccountingPosition['blockers'],
    revenue: Decimal,
    projectCost: Decimal,
    mayViewFinancials: boolean,
  ): ProjectAccountingPosition {
    if (!ready || !mayViewFinancials) {
      return {
        available: false,
        revenue: null,
        projectCost: null,
        grossProfit: null,
        marginPercent: null,
        blockers: ready ? [] : blockers,
      };
    }

    const grossProfit = revenue.minus(projectCost);
    return {
      available: true,
      revenue: revenue.toFixed(2),
      projectCost: projectCost.toFixed(2),
      grossProfit: grossProfit.toFixed(2),
      // No revenue means no denominator. A margin of 0% would claim the project broke even.
      marginPercent: revenue.greaterThan(0)
        ? Math.round(grossProfit.div(revenue).mul(1000).toNumber()) / 10
        : null,
      blockers: [],
    };
  }

  private buildPeriod(
    period: { id: string; name: string; status: string; endDate: Date } | null,
  ): ProjectFinancePeriod | null {
    if (!period) return null;
    const today = new Date();
    const endOfDay = new Date(period.endDate);
    const daysToPeriodEnd = Math.ceil(
      (endOfDay.getTime() - new Date(today.toDateString()).getTime()) / 86_400_000,
    );
    return {
      id: period.id,
      name: period.name,
      status: period.status,
      endDate: period.endDate.toISOString().slice(0, 10),
      daysToPeriodEnd,
    };
  }

  private reconciliationStatus(
    reconciliation: ProjectFinanceOverviewResponse['reconciliation'],
  ): FinanceControlStatus {
    if (reconciliation.reconciled) {
      return {
        state: 'OK',
        label: 'Reconciled',
        detail: `Supplier-bill variance ${reconciliation.variance}`,
      };
    }
    return {
      state: 'ATTENTION',
      label: 'Needs review',
      detail: `Supplier-bill variance ${reconciliation.variance}`,
    };
  }

  private setupStatus(readiness: { ready: boolean; blockers: unknown[] }): FinanceControlStatus {
    return readiness.ready
      ? { state: 'OK', label: 'Ready', detail: 'Chart of accounts, period and posting profiles' }
      : {
          state: 'UNAVAILABLE',
          label: 'Incomplete',
          detail: `${readiness.blockers.length} item(s) to configure`,
        };
  }

  private budgetStatus(
    baselined: { versionNumber: number; baselinedAt: Date | null } | null,
    draft: { versionNumber: number } | null,
  ): FinanceControlStatus {
    if (baselined) {
      return {
        state: 'OK',
        label: 'Baselined',
        detail: `Version ${baselined.versionNumber}`,
      };
    }
    if (draft) {
      // "Working", never "Draft awaiting approval": the model has no approval step, and naming
      // one would re-create the fake control this programme removed from journals.
      return {
        state: 'ATTENTION',
        label: 'Working',
        detail: `Version ${draft.versionNumber} is not baselined`,
      };
    }
    return { state: 'UNAVAILABLE', label: 'Not baselined', detail: 'No cost budget set' };
  }

  private periodStatus(period: ProjectFinancePeriod | null): FinanceControlStatus {
    if (!period) {
      return {
        state: 'UNAVAILABLE',
        label: 'None',
        detail: 'No accounting period covers today',
      };
    }
    const postable = period.status === 'OPEN' || period.status === 'REOPENED';
    return {
      state: postable ? 'OK' : 'ATTENTION',
      label: period.status === 'REOPENED' ? 'Reopened' : postable ? 'Open' : 'Locked',
      detail: period.name,
    };
  }

  private buildAttention(input: {
    reconciliation: ProjectFinanceOverviewResponse['reconciliation'];
    readiness: { ready: boolean; blockers: Array<{ label: string }> };
    baselined: boolean;
    draft: { versionNumber: number } | null;
    periodInfo: ProjectFinancePeriod | null;
    unpostedBills: { count: number; total: Decimal };
    projectId: string;
  }): FinanceAttentionItem[] {
    const items: FinanceAttentionItem[] = [];
    const { reconciliation, readiness, baselined, draft, periodInfo, unpostedBills, projectId } =
      input;

    if (!reconciliation.reconciled) {
      items.push({
        code: 'RECONCILIATION_VARIANCE',
        severity: 'CRITICAL',
        title: 'Procurement and the general ledger disagree',
        detail: `Supplier-bill variance ${reconciliation.variance}. Project cost figures cannot be relied on until this is resolved.`,
        href: `/projects/${projectId}/finance/ledger`,
      });
    }

    if (reconciliation.unattributedBillLines > 0) {
      items.push({
        code: 'UNATTRIBUTED_BILL_LINES',
        severity: 'CRITICAL',
        title: `${reconciliation.unattributedBillLines} posted bill line(s) carry no project`,
        detail: 'This cost has reached the accounts without project attribution.',
        href: null,
      });
    }

    if (!readiness.ready) {
      items.push({
        code: 'ACCOUNTING_SETUP_INCOMPLETE',
        severity: 'WARNING',
        title: 'Accounting setup is incomplete',
        detail: readiness.blockers.map((b) => b.label).join(', '),
        href: null,
      });
    }

    if (unpostedBills.count > 0) {
      items.push({
        code: 'BILLS_AWAITING_POSTING',
        severity: 'WARNING',
        title: `${unpostedBills.count} supplier bill(s) approved but not posted`,
        detail: `Total value ${unpostedBills.total.toFixed(2)}. This cost is not yet in the accounts.`,
        href: '/finance/accounting/bills',
      });
    }

    if (!baselined && draft) {
      items.push({
        code: 'BUDGET_DRAFT_NOT_BASELINED',
        severity: 'INFO',
        title: `Cost budget version ${draft.versionNumber} is not baselined`,
        detail: 'Budget comparisons are unavailable until a version is baselined.',
        href: `/projects/${projectId}/finance/cost-control`,
      });
    } else if (!baselined && !draft) {
      items.push({
        code: 'NO_BASELINED_BUDGET',
        severity: 'INFO',
        title: 'No cost budget has been set',
        detail: 'Cost is tracked, but there is nothing to measure it against.',
        href: `/projects/${projectId}/finance/cost-control`,
      });
    }

    // Only from a computed date. A countdown invented in the browser is not a control.
    if (
      periodInfo &&
      periodInfo.daysToPeriodEnd >= 0 &&
      periodInfo.daysToPeriodEnd <= PERIOD_CLOSING_WARNING_DAYS
    ) {
      items.push({
        code: 'PERIOD_CLOSING_SOON',
        severity: 'INFO',
        title: `${periodInfo.name} ends in ${periodInfo.daysToPeriodEnd} day(s)`,
        detail: 'Costs for this period should be posted before it closes.',
        href: null,
      });
    }

    return items;
  }

  /**
   * Financially meaningful events only: postings that moved this project's accounts, and the
   * budget-lifecycle acts that changed what it is measured against. Ordinary procurement traffic
   * belongs to the Procurement tab.
   */
  private async buildActivity(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    projectId: string,
    mayViewFinancials: boolean,
  ): Promise<FinanceActivityRow[]> {
    const [journals, budgetEvents] = await Promise.all([
      this.repo.findRecentProjectPostings(prisma, orgId, projectId, ACTIVITY_LIMIT),
      this.repo.findRecentBudgetEvents(prisma, orgId, projectId, ACTIVITY_LIMIT),
    ]);

    const SOURCE_LABEL: Record<string, string> = {
      SUPPLIER_BILL: 'Supplier bill',
      CLIENT_INVOICE: 'Client invoice',
      MANUAL_JOURNAL: 'Manual journal',
      PAYMENT_RECEIPT: 'Receipt',
      SUPPLIER_PAYMENT: 'Supplier payment',
      OPENING_BALANCE: 'Opening balance',
      YEAR_END_CLOSE: 'Year-end close',
    };

    const rows: FinanceActivityRow[] = journals.map((j) => ({
      id: j.id,
      date: j.accountingDate.toISOString().slice(0, 10),
      description: j.description,
      source: j.sourceDocumentType ? (SOURCE_LABEL[j.sourceDocumentType] ?? 'Journal') : 'Journal',
      reference: j.journalNumber,
      amount: mayViewFinancials ? j.projectAmount.toFixed(2) : null,
      sourceDocumentType: j.sourceDocumentType,
      sourceDocumentId: j.sourceDocumentId,
    }));

    for (const event of budgetEvents) {
      rows.push({
        id: event.id,
        date: event.createdAt.toISOString().slice(0, 10),
        description:
          event.action === 'BASELINE'
            ? 'Cost budget baselined'
            : event.action === 'CREATE'
              ? 'Cost budget drafted'
              : 'Cost budget updated',
        source: 'Cost budget',
        reference: null,
        // A baseline moves no money; reporting an amount would invent one.
        amount: null,
        sourceDocumentType: null,
        sourceDocumentId: null,
      });
    }

    return rows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, ACTIVITY_LIMIT);
  }
}
