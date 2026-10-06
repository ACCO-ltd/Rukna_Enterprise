import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type DashboardProjectInPreparation,
  type DashboardProjectInProgress,
  type DashboardResponse,
  type DashboardTodoItem,
  type ProgrammeMilestoneResponse,
  type ProjectReadinessResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { AccountingGuideService } from '../../../accounting/accounting-core/application/accounting-guide.service.js';
import { installmentBillingBlocker } from '../../../accounting/accounts-receivable/domain/installment-billing-eligibility.js';
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';
import { daysPastDue } from '../../commercial/domain/commercial-workspace.policy.js';
import { CommercialPrismaRepository } from '../../commercial/infrastructure/commercial-prisma.repository.js';
import { FinancePortfolioService } from '../../finance-portfolio/application/finance-portfolio.service.js';
import { readyStageToBill } from '../../finance-portfolio/domain/finance-portfolio.policy.js';
import { findOpenPostedBills } from '../../finance-portfolio/infrastructure/bills-to-pay.query.js';
import { ProgrammeService } from '../../programme/application/programme.service.js';
import { ProgressService } from '../../progress/application/progress.service.js';
import { ProjectService } from '../../projects/application/project.service.js';
import {
  IN_PROGRESS_STATUSES,
  buildFigures,
  buildSetupSteps,
  byEarliestNeed,
  byMostLate,
  decideStage,
  moneyOrNull,
  preparationProgress,
  rankTodo,
  TODO_TONE,
} from '../domain/dashboard.policy.js';
import {
  countOrgProjectsByStatus,
  findBillMatchExceptions,
  findBillsAwaitingApproval,
  findDashboardProjects,
  findMaterialRequestsAwaitingApproval,
  findOrganizationName,
  findReportsAwaitingReview,
  findSetupFacts,
} from '../infrastructure/dashboard.queries.js';

/** How many of the caller's projects feed "Latest activity", and how many events it shows. */
const ACTIVITY_PROJECTS = 10;
const ACTIVITY_EVENTS = 5;

const isoDate = (d: Date | null | undefined): string | null =>
  d ? d.toISOString().slice(0, 10) : null;
const dec = (v: { toString(): string }) => new Decimal(v.toString());

/**
 * The Dashboard read model (`GET /dashboard`, design-system P30–P32): one response scoped to the
 * caller. It owns no formula — every figure is read through the module that owns it:
 *
 * - project rows (contract value, outstanding, overdue, client): `FinancePortfolioService.buildRows`
 *   (ADR-043), with the same project-access rule and money gate;
 * - receivables + aging: `CommercialPrismaRepository.findOpenPostedInvoices` folded by
 *   `computeReceivablePosition` and `agingBucket` (in `buildFigures`);
 * - payables: `findOpenPostedBills`, the portfolio's bills-to-pay rule;
 * - stages to bill: `findReadyToBillInstallments` + `readyStageToBill` (the portfolio's rule) +
 *   `installmentBillingBlocker(at: 'raise')`;
 * - Preparation readiness: `ProjectService.getStartReadinessMany` (`evaluateReadiness('start')`);
 * - planned / physical %: `ProgressService.getScheduleReading`; milestones ready to verify:
 *   `ProgrammeService.listMilestones`; activity: `ProjectService.getRecentActivityAcross`;
 * - accounting setup: `AccountingGuideService.getSetupCycle` (the guide's own setup cycle).
 *
 * Money is visible on exactly the portfolio's rule: `canViewMargin` and `view:financial-position`.
 * Hidden money is null — never "0.00".
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly portfolio: FinancePortfolioService,
    private readonly commercialRepo: CommercialPrismaRepository,
    private readonly projects: ProjectService,
    private readonly progress: ProgressService,
    private readonly programme: ProgrammeService,
    private readonly accountingGuide: AccountingGuideService,
  ) {}

  async get(identity: RequestIdentity): Promise<DashboardResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const today = new Date();
    const can = (permission: string) => identity.permissions.includes(permission);
    const moneyVisible =
      resolveBoqVisibility(identity).canViewMargin && can(PERMISSIONS.financialPositionView);

    const accessible = await this.projectAccess.accessibleProjectIds(identity);
    const scope = accessible ?? null; // null = every project of the organisation

    // ── Phase 1: the organisation, the caller's projects and their portfolio rows ───────
    const [organizationName, orgStatusCounts, projects, portfolio] = await Promise.all([
      findOrganizationName(prisma, orgId),
      countOrgProjectsByStatus(prisma, orgId),
      findDashboardProjects(prisma, orgId, scope),
      this.portfolio.buildRows(identity, {}),
    ]);
    const stage = decideStage(orgStatusCounts);
    const rowById = new Map(portfolio.rows.map((row) => [row.projectId, row]));
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const projectIds = projects.map((p) => p.id);
    const inProgress = projects.filter((p) =>
      (IN_PROGRESS_STATUSES as readonly string[]).includes(p.status),
    );
    const drafts = projects.filter((p) => p.status === 'DRAFT');
    const activityProjects = projects
      .filter((p) => p.status !== 'CLOSED' && p.status !== 'CANCELLED')
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      .slice(0, ACTIVITY_PROJECTS)
      .map((p) => ({ id: p.id, name: p.name }));
    const contracts = [...portfolio.contracts.values()];

    // ── Phase 2: every source, gated, in parallel ─────────────────────────────────────────
    const [
      readiness,
      readings,
      milestones,
      activity,
      openInvoices,
      openBills,
      materialRequests,
      matchExceptions,
      billsAwaiting,
      reports,
      accountingSetup,
      setupFacts,
      readyStages,
    ] = await Promise.all([
      this.projects.getStartReadinessMany(
        identity,
        drafts.map((p) => p.id),
      ),
      Promise.all(
        inProgress.map((p) =>
          this.progress
            .getScheduleReading(identity, p.id)
            .catch(() => ({ plannedPercent: null, physicalPercent: null })),
        ),
      ),
      can(PERMISSIONS.projectsManage)
        ? Promise.all(
            inProgress.map((p) =>
              this.programme
                .listMilestones(identity, p.id)
                .catch((): ProgrammeMilestoneResponse[] => []),
            ),
          )
        : Promise.resolve([] as ProgrammeMilestoneResponse[][]),
      this.projects.getRecentActivityAcross(identity, activityProjects, ACTIVITY_EVENTS),
      moneyVisible
        ? this.commercialRepo.findOpenPostedInvoices(prisma, orgId, scope)
        : Promise.resolve([]),
      moneyVisible ? findOpenPostedBills(prisma, orgId, scope) : Promise.resolve([]),
      can(PERMISSIONS.materialRequestsApprove)
        ? findMaterialRequestsAwaitingApproval(prisma, orgId, identity.userId, scope)
        : Promise.resolve([]),
      can(PERMISSIONS.payablesManage)
        ? findBillMatchExceptions(prisma, orgId, scope)
        : Promise.resolve([]),
      can(PERMISSIONS.payablesManage)
        ? findBillsAwaitingApproval(prisma, orgId, identity.userId, scope)
        : Promise.resolve([]),
      can(PERMISSIONS.progressApprove)
        ? findReportsAwaitingReview(prisma, orgId, projectIds)
        : Promise.resolve([]),
      can(PERMISSIONS.accountingView) || stage === 'NEW'
        ? this.accountingGuide.getSetupCycle(identity)
        : Promise.resolve(null),
      stage === 'NEW' ? findSetupFacts(prisma, orgId) : Promise.resolve(null),
      can(PERMISSIONS.receivablesManage)
        ? this.commercialRepo.findReadyToBillInstallments(
            prisma,
            contracts.map((c) => c.id),
          )
        : Promise.resolve([]),
    ]);

    // ── Projects ───────────────────────────────────────────────────────────────────────
    const inProgressRows: DashboardProjectInProgress[] = inProgress.map((p, i) => {
      const row = rowById.get(p.id);
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        clientName: row?.clientName ?? p.client?.name ?? p.clientName ?? null,
        status: p.status,
        physicalPercent: readings[i]?.physicalPercent ?? null,
        plannedPercent: readings[i]?.plannedPercent ?? null,
        currency: row?.currency ?? p.currency ?? null,
        contractValue: row?.contractValue ?? null,
        outstanding: row?.outstanding ?? null,
        overdue: row?.overdue ?? null,
      };
    });

    const inPreparation: DashboardProjectInPreparation[] = drafts.map((p) => {
      const contract = portfolio.contracts.get(p.id);
      const conditions = readiness.get(p.id)?.conditions ?? [];
      let value: DashboardProjectInPreparation['value'] = null;
      if (moneyVisible) {
        if (contract && contract.status === 'ACTIVE') {
          value = {
            amount: dec(contract.contractValue).toFixed(2),
            currency: contract.currency,
            source: 'CONTRACT',
          };
        } else if (p.contractValue !== null) {
          value = {
            amount: dec(p.contractValue).toFixed(2),
            currency: p.currency,
            source: 'ESTIMATE',
          };
        }
      }
      return {
        id: p.id,
        code: p.code,
        name: p.name,
        clientName: rowById.get(p.id)?.clientName ?? p.client?.name ?? p.clientName ?? null,
        ...preparationProgress(conditions),
        value,
      };
    });

    const statusCounts: Record<string, number> = {};
    for (const p of projects) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;

    // ── Figures ────────────────────────────────────────────────────────────────────────
    const figures = moneyVisible
      ? buildFigures({
          today,
          activeProjects: projects
            .filter((p) => p.status === 'ACTIVE')
            .map((p) => {
              const contract = portfolio.contracts.get(p.id);
              return {
                currency: rowById.get(p.id)?.currency ?? p.currency ?? null,
                contractValue: contract ? dec(contract.contractValue) : null,
                contractCurrency: contract?.currency ?? null,
              };
            }),
          openInvoices: openInvoices.map((inv) => ({
            currencyCode: inv.currencyCode,
            totalAmount: dec(inv.totalAmount),
            outstandingAmount: dec(inv.outstandingAmount),
            dueDate: inv.dueDate,
          })),
          openBills: openBills.map((bill) => ({
            currencyCode: bill.currencyCode,
            outstandingAmount: dec(bill.outstandingAmount),
            dueDate: bill.dueDate,
          })),
        })
      : null;

    // ── To do ──────────────────────────────────────────────────────────────────────────
    const todo: DashboardTodoItem[] = [];
    const nameOf = (projectId: string | null) =>
      projectId ? (projectById.get(projectId)?.name ?? null) : null;

    if (moneyVisible) {
      const overdue = openInvoices
        .map((inv) => ({ inv, daysLate: inv.dueDate ? daysPastDue(inv.dueDate, today) : 0 }))
        .filter(({ daysLate }) => daysLate > 0)
        .map(({ inv, daysLate }) => ({
          key: `invoice-overdue:${inv.id}`,
          kind: 'INVOICE_OVERDUE' as const,
          tone: TODO_TONE.INVOICE_OVERDUE,
          href: `/finance/accounting/invoices/${inv.id}`,
          amount: dec(inv.outstandingAmount).toFixed(2),
          currency: inv.currencyCode,
          invoiceNumber: inv.invoiceNumber ?? '',
          clientName: inv.client?.name ?? null,
          projectName: nameOf(inv.projectId),
          dueDate: isoDate(inv.dueDate)!,
          daysLate,
        }))
        .sort(byMostLate);
      todo.push(...overdue);
    }

    todo.push(
      ...materialRequests
        .map((mr) => ({
          key: `material-request:${mr.id}`,
          kind: 'MATERIAL_REQUEST_AWAITING_APPROVAL' as const,
          tone: TODO_TONE.MATERIAL_REQUEST_AWAITING_APPROVAL,
          href: `/procurement/requests/${mr.id}`,
          amount: null,
          currency: null,
          mrNumber: mr.mrNumber,
          title: mr.title,
          projectName: nameOf(mr.projectId),
          requiredByDate: isoDate(mr.requiredByDate),
        }))
        .sort(byEarliestNeed),
    );

    for (const bill of matchExceptions) {
      todo.push({
        key: `bill-match-exception:${bill.id}`,
        kind: 'BILL_MATCH_EXCEPTION',
        tone: TODO_TONE.BILL_MATCH_EXCEPTION,
        href: `/finance/accounting/bills/${bill.id}`,
        amount: moneyOrNull(moneyVisible, dec(bill.totalAmount)),
        currency: moneyVisible ? bill.currencyCode : null,
        billNumber: bill.billNumber,
        supplierName: bill.supplier?.name ?? null,
      });
    }

    if (billsAwaiting.length > 0) {
      const oldest = billsAwaiting[0]!;
      const currencies = new Set(billsAwaiting.map((b) => b.currencyCode));
      // One sum only when every bill is in one currency — money is never added across currencies.
      const single = moneyVisible && currencies.size === 1;
      todo.push({
        key: 'bills-awaiting-approval',
        kind: 'BILLS_AWAITING_APPROVAL',
        tone: TODO_TONE.BILLS_AWAITING_APPROVAL,
        // The bills list has no status filter in the URL yet; it opens on the full list.
        href: '/finance/accounting/bills',
        amount: single
          ? (billsAwaiting as Array<(typeof billsAwaiting)[number]>)
              .reduce((sum, b) => sum.plus(dec(b.totalAmount)), new Decimal(0))
              .toFixed(2)
          : null,
        currency: single ? oldest.currencyCode : null,
        count: billsAwaiting.length,
        oldestBillNumber: oldest.billNumber,
        oldestSupplierName: oldest.supplier?.name ?? null,
        oldestSubmittedAt: oldest.updatedAt.toISOString(),
      });
    }

    if (can(PERMISSIONS.accountingView) && accountingSetup && !accountingSetup.ready) {
      todo.push({
        key: 'accounting-setup',
        kind: 'ACCOUNTING_SETUP_INCOMPLETE',
        tone: TODO_TONE.ACCOUNTING_SETUP_INCOMPLETE,
        href: '/finance/accounting/guide',
        amount: null,
        currency: null,
        stepsLeft: accountingSetup.cycle.steps.filter((s) => s.status !== 'DONE').length,
      });
    }

    for (const r of [...reports].sort(
      (a, b) => (a.oldestReportDate?.getTime() ?? 0) - (b.oldestReportDate?.getTime() ?? 0),
    )) {
      todo.push({
        key: `reports:${r.projectId}`,
        kind: 'REPORTS_TO_REVIEW',
        tone: TODO_TONE.REPORTS_TO_REVIEW,
        href: `/projects/${r.projectId}/progress/review`,
        amount: null,
        currency: null,
        projectName: nameOf(r.projectId) ?? '',
        count: r.count,
        oldestReportDate: isoDate(r.oldestReportDate) ?? '',
      });
    }

    inProgress.forEach((p, i) => {
      for (const m of milestones[i] ?? []) {
        if (!m.readyToVerify) continue;
        todo.push({
          key: `milestone:${m.id}`,
          kind: 'MILESTONE_READY_TO_VERIFY',
          tone: TODO_TONE.MILESTONE_READY_TO_VERIFY,
          // The Verify action lives on the Progress → Review screen (VerifyMilestoneDialog).
          href: `/projects/${p.id}/progress/review`,
          amount: null,
          currency: null,
          projectName: p.name,
          milestoneLabel: m.name,
        });
      }
    });

    todo.push(
      ...(await this.stagesToBill(
        identity,
        readyStages,
        portfolio.contracts,
        projectById,
        moneyVisible,
      )),
    );

    if (can(PERMISSIONS.projectsManage)) {
      for (const p of drafts) {
        if (!readiness.get(p.id)?.ready) continue;
        todo.push({
          key: `ready-to-start:${p.id}`,
          kind: 'PROJECT_READY_TO_START',
          tone: TODO_TONE.PROJECT_READY_TO_START,
          href: `/projects/${p.id}`,
          amount: null,
          currency: null,
          projectName: p.name,
        });
      }
    }

    if (can(PERMISSIONS.contractsView)) {
      const withoutContract = drafts.filter(
        (p) =>
          p.commercialModel === 'CLIENT_CONTRACT' && !hasActiveMainContract(readiness.get(p.id)),
      ).length;
      if (withoutContract > 0) {
        todo.push({
          key: 'projects-without-contract',
          kind: 'PROJECTS_WITHOUT_CONTRACT',
          tone: TODO_TONE.PROJECTS_WITHOUT_CONTRACT,
          // The projects list has no status filter in the URL yet.
          href: '/projects',
          amount: null,
          currency: null,
          count: withoutContract,
        });
      }
    }

    return {
      organizationName,
      stage,
      moneyVisible,
      projectScope: accessible ? 'MINE' : 'ALL',
      todo: rankTodo(todo),
      figures,
      projects: { inProgress: inProgressRows, inPreparation, statusCounts },
      activity,
      setup:
        stage === 'NEW' && setupFacts
          ? buildSetupSteps(
              { ...setupFacts, accountingReady: accountingSetup?.ready ?? false },
              identity.permissions,
            )
          : null,
      asOf: today.toISOString(),
    };
  }

  /**
   * STAGE_READY_TO_BILL rows: a stage marked ready whose invoice is not issued (`readyStageToBill`,
   * the portfolio's rule) AND that `installmentBillingBlocker(at: 'raise')` clears — so the row
   * never points at a stage the invoice generator would refuse.
   */
  private async stagesToBill(
    identity: RequestIdentity,
    stages: Awaited<ReturnType<CommercialPrismaRepository['findReadyToBillInstallments']>>,
    contractsByProject: Awaited<ReturnType<FinancePortfolioService['buildRows']>>['contracts'],
    projectById: ReadonlyMap<string, { id: string; code: string; name: string }>,
    moneyVisible: boolean,
  ): Promise<DashboardTodoItem[]> {
    const contractById = new Map([...contractsByProject.values()].map((c) => [c.id, c]));
    const candidates = stages.flatMap((stage) => {
      const contract = contractById.get(stage.contractId);
      if (!contract) return [];
      const toBill = readyStageToBill(stage, contract);
      if (!toBill) return [];
      const blocker = installmentBillingBlocker(
        {
          triggerType: stage.triggerType,
          programmeMilestoneId: stage.programmeMilestoneId,
          programmeMilestone: stage.programmeMilestone,
          contractStatus: contract.status,
        },
        { at: 'raise' },
      );
      return blocker === null ? [{ stage, contract, toBill }] : [];
    });
    if (candidates.length === 0) return [];

    const order = await this.commercialRepo.findInstallmentOrder(this.tenancy.getClient(), [
      ...new Set(candidates.map((c) => c.contract.id)),
    ]);
    const position = new Map<string, number>();
    const seen = new Map<string, number>();
    for (const row of order) {
      const n = (seen.get(row.contractId) ?? 0) + 1;
      seen.set(row.contractId, n);
      position.set(row.id, n);
    }
    const hrefFor = (projectId: string) =>
      identity.permissions.includes(PERMISSIONS.financialPositionView)
        ? `/finance/projects/${projectId}/billing`
        : identity.permissions.includes(PERMISSIONS.contractsView)
          ? `/projects/${projectId}/commercial/contract`
          : `/projects/${projectId}`;

    return candidates
      .map(({ stage, contract, toBill }) => ({
        key: `stage-ready:${stage.id}`,
        kind: 'STAGE_READY_TO_BILL' as const,
        tone: TODO_TONE.STAGE_READY_TO_BILL,
        href: hrefFor(contract.projectId),
        amount: moneyOrNull(moneyVisible, toBill.amount),
        currency: moneyVisible ? contract.currency : null,
        projectName: projectById.get(contract.projectId)?.name ?? '',
        stageNumber: position.get(stage.id) ?? 0,
        stageLabel: stage.name,
        milestoneLabel: stage.programmeMilestone?.name ?? null,
        verifiedAt: stage.programmeMilestone?.verifiedAt?.toISOString() ?? null,
        draftPrepared: toBill.draftPrepared,
        projectCode: projectById.get(contract.projectId)?.code ?? '',
      }))
      .sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.stageNumber - b.stageNumber)
      .map(({ projectCode: _projectCode, ...item }) => item);
  }
}

/** The readiness condition behind "projects without a contract" — the Start checklist's own. */
function hasActiveMainContract(readiness: ProjectReadinessResponse | undefined): boolean {
  return readiness?.conditions.find((c) => c.code === 'ACTIVE_MAIN_CONTRACT')?.satisfied ?? false;
}
