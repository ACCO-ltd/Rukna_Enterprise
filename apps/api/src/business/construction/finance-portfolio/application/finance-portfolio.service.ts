import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type FinancePortfolioProjectResponse,
  type FinancePortfolioQuery,
  type FinancePortfolioResponse,
  type FinancePortfolioRow,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { AccountingReadinessService } from '../../../accounting/accounting-core/application/accounting-readiness.service.js';
import { buildAccountingPosition } from '../../../accounting/financial-position/application/accounting-position.js';
import { ProjectFinancialPositionRepository } from '../../../accounting/financial-position/infrastructure/project-financial-position.repository.js';
import { supplierBillProjectWhere } from '../../../accounting/accounts-payable/infrastructure/supplier-bill.repository.js';
import { ProjectProcurementRepository } from '../../../procurement/project-procurement/infrastructure/project-procurement.repository.js';
import {
  addStage,
  buildPosition,
  emptyStageTotals,
  type StageTotals,
} from '../../../procurement/project-procurement/domain/project-cost-rollup.js';
import { resolveBoqVisibility } from '../../boq/domain/boq-visibility.policy.js';
import { deriveInvoiceState } from '../../commercial/domain/commercial-workspace.policy.js';
import { CommercialPrismaRepository } from '../../commercial/infrastructure/commercial-prisma.repository.js';
import {
  computeReceivablePosition,
  scheduleBaseValue,
} from '../../commercial/domain/receivable-position.js';
import { inQueue, matchesSearch, portfolioTotals, queueCounts } from '../domain/finance-portfolio.policy.js';

const ZERO = new Decimal(0);

/**
 * ADR-043 — the Finance workspace's project portfolio: one row per project the caller may see,
 * with the figures each per-project screen already owns.
 *
 * Read-only and batched: a fixed number of queries for the whole portfolio (no per-project loop),
 * each built from the SAME repository filter or pure formula the per-project read model uses —
 *
 * - receivables: `CommercialPrismaRepository.findPostedReceivablesByProject` (also behind
 *   `findProjectOverviewData`) folded by `computeReceivablePosition` (also behind
 *   `CommercialService.getOverview`);
 * - cost: the commitment ledger grouped by stage, folded by `addStage` + `buildPosition` (Cost
 *   Control / Finance Overview `costPosition`);
 * - margin: `sumPostedRevenueByProject` / `sumProjectCostByProject` into `buildAccountingPosition`
 *   (Finance Overview `accountingPosition`);
 * - ready to bill: stages with `readyToBillAt` whose invoice is not ISSUED (`deriveInvoiceState`,
 *   the payment schedule's rule; a DRAFT invoice counts as "draft prepared"), priced by
 *   `scheduleBaseValue` × percentage as the payment schedule does;
 * - bills to pay: POSTED supplier bills with an outstanding balance, matched to a project by
 *   `supplierBillProjectWhere` (the bills list's own rule).
 */
@Injectable()
export class FinancePortfolioService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly readiness: AccountingReadinessService,
    private readonly commercialRepo: CommercialPrismaRepository,
    private readonly procurementRepo: ProjectProcurementRepository,
    private readonly financeRepo: ProjectFinancialPositionRepository,
  ) {}

  async list(identity: RequestIdentity, query: FinancePortfolioQuery = {}): Promise<FinancePortfolioResponse> {
    const built = await this.buildRows(identity, { status: query.status });
    const searched = built.rows.filter((row) => matchesSearch(row, query.search));
    const items = query.queue ? searched.filter((row) => inQueue(row, query.queue!)) : searched;

    return {
      items,
      totals: portfolioTotals(items, (projectIds) => built.distinctBills(projectIds), built.moneyVisible),
      queueCounts: queueCounts(searched),
      moneyVisible: built.moneyVisible,
      marginVisible: built.marginVisible,
      asOf: built.asOf,
    };
  }

  /**
   * One project's row — the Finance workspace header. Same figures, gate and scoping as the list:
   * 404 outside the organisation, 403 for a project the caller is not a member of.
   */
  async getOne(identity: RequestIdentity, projectId: string): Promise<FinancePortfolioProjectResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const built = await this.buildRows(identity, { projectId });
    const item = built.rows[0];
    if (!item) throw new NotFoundException(`Project ${projectId} not found`);
    return { item, moneyVisible: built.moneyVisible, marginVisible: built.marginVisible, asOf: built.asOf };
  }

  /** The rows for the caller's projects (optionally one project / one status), batched. */
  private async buildRows(identity: RequestIdentity, filter: { projectId?: string; status?: string }) {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const today = new Date();
    // Receivable money follows the Commercial Overview's gate; cost and margin the Finance
    // Overview's. Under the endpoint's own gate (view:financial-position) both are granted.
    const { canViewMargin } = resolveBoqVisibility(identity);
    const receivablesVisible = canViewMargin;
    const costVisible = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const moneyVisible = receivablesVisible && costVisible;
    const marginVisible = canViewMargin && costVisible;

    // ── The projects this caller may see (tenancy + the project access rule) ──────────────
    const accessible = await this.projectAccess.accessibleProjectIds(identity);
    const projects = await prisma.project.findMany({
      where: {
        organizationId: orgId,
        ...(accessible ? { id: { in: accessible } } : {}),
        ...(filter.projectId ? { id: filter.projectId } : {}),
        ...(filter.status ? { status: filter.status as never } : {}),
      },
      select: {
        id: true,
        code: true,
        name: true,
        status: true,
        currency: true,
        clientName: true,
        client: { select: { name: true } },
      },
      orderBy: { code: 'asc' },
    });
    const ids = projects.map((p) => p.id);

    const [contracts, receivables, stageRows, revenue, glCost, readiness, bills] = await Promise.all([
      this.commercialRepo.findMainContractsByProject(prisma, orgId, ids),
      this.commercialRepo.findPostedReceivablesByProject(prisma, orgId, ids),
      ids.length ? this.procurementRepo.groupByProjectAndStage(prisma, orgId, ids) : Promise.resolve([]),
      this.financeRepo.sumPostedRevenueByProject(prisma, orgId, ids),
      this.financeRepo.sumProjectCostByProject(prisma, orgId, ids),
      this.readiness.getReadiness(identity),
      ids.length
        ? prisma.supplierBill.findMany({
            where: {
              organizationId: orgId,
              postingStatus: 'POSTED',
              outstandingAmount: { gt: 0 },
              ...supplierBillProjectWhere({ in: ids }),
            },
            select: { id: true, projectId: true, outstandingAmount: true, lines: { select: { projectId: true } } },
          })
        : Promise.resolve([]),
    ]);

    const contractIds = [...contracts.values()].map((c) => c.id);
    const readyInstallments = await this.commercialRepo.findReadyToBillInstallments(prisma, contractIds);

    // ── Fold each source per project ───────────────────────────────────────────────────────
    const stageTotals = new Map<string, StageTotals>();
    for (const row of stageRows) {
      if (!row.projectId) continue;
      const totals = stageTotals.get(row.projectId) ?? emptyStageTotals();
      addStage(totals, row.stage, new Decimal(row._sum.amount?.toString() ?? 0));
      stageTotals.set(row.projectId, totals);
    }

    const contractById = new Map([...contracts.values()].map((c) => [c.id, c]));
    // ADR-043 decision 1 — Finance issues invoices. The stage's invoice state is the payment
    // schedule's own rule (`deriveInvoiceState`): ISSUED (posted, reversed or opening balance) is
    // billed; DRAFT (not yet posted, incl. pending/failed) stays "to bill" as "draft prepared";
    // none (no invoice, or a cancelled one) stays "to bill" as "not prepared".
    const ready = new Map<string, { count: number; draftCount: number; amount: Decimal }>();
    for (const inst of readyInstallments) {
      const invoiceState = deriveInvoiceState(inst.clientInvoice);
      if (invoiceState === 'ISSUED') continue; // billed
      const contract = contractById.get(inst.contractId);
      if (!contract) continue;
      const entry = ready.get(contract.projectId) ?? { count: 0, draftCount: 0, amount: ZERO };
      entry.count += 1;
      if (invoiceState === 'DRAFT') entry.draftCount += 1;
      entry.amount = entry.amount.plus(scheduleBaseValue(contract).mul(inst.percentage.toString()));
      ready.set(contract.projectId, entry);
    }

    const idSet = new Set(ids);
    const billsByProject = new Map<string, { id: string; outstanding: Decimal }[]>();
    for (const bill of bills) {
      const owners = new Set<string>();
      if (bill.projectId && idSet.has(bill.projectId)) owners.add(bill.projectId);
      for (const line of bill.lines) if (line.projectId && idSet.has(line.projectId)) owners.add(line.projectId);
      for (const owner of owners) {
        const list = billsByProject.get(owner) ?? [];
        list.push({ id: bill.id, outstanding: new Decimal(bill.outstandingAmount.toString()) });
        billsByProject.set(owner, list);
      }
    }

    const money = (d: Decimal | null | undefined): string | null =>
      moneyVisible && d !== null && d !== undefined ? d.toFixed(2) : null;

    const allRows: FinancePortfolioRow[] = projects.map((p) => {
      const contract = contracts.get(p.id) ?? null;
      const rec = receivables.get(p.id);
      const position = computeReceivablePosition({
        invoices: rec?.invoices ?? [],
        postedCreditNotesSum: rec?.postedCreditNotesSum ?? ZERO,
        collectedSum: rec?.collectedSum ?? ZERO,
        today,
      });
      const cost = buildPosition(stageTotals.get(p.id) ?? emptyStageTotals(), null, null, costVisible);
      const accounting = buildAccountingPosition(
        readiness.ready,
        readiness.blockers,
        revenue.get(p.id) ?? ZERO,
        glCost.get(p.id) ?? ZERO,
        marginVisible,
      );
      const readyEntry = ready.get(p.id);
      const projectBills = billsByProject.get(p.id) ?? [];
      return {
        projectId: p.id,
        code: p.code,
        name: p.name,
        clientName: contract?.client?.name ?? p.client?.name ?? p.clientName ?? null,
        status: p.status,
        currency: contract?.currency ?? p.currency ?? null,
        contractValue: contract ? money(new Decimal(contract.contractValue.toString())) : null,
        billed: money(position.netBilled),
        collected: money(position.collected),
        outstanding: money(position.outstanding),
        overdue: money(position.overdue),
        costToDate: moneyVisible ? cost.actual : null,
        committedCost: moneyVisible ? cost.committedToDate : null,
        margin: marginVisible ? accounting.marginPercent : null,
        readyToBill: {
          count: readyEntry?.count ?? 0,
          draftCount: readyEntry?.draftCount ?? 0,
          amount: money(readyEntry?.amount ?? ZERO),
        },
        overdueInvoices: { count: position.overdueCount, oldestDaysPastDue: position.oldestDaysPastDue },
        billsToPay: {
          count: projectBills.length,
          amount: money(projectBills.reduce((s, b) => s.plus(b.outstanding), ZERO)),
        },
      };
    });

    /** Distinct bills to pay across a set of projects — a bill coded to two projects counts once. */
    const distinctBills = (projectIds: string[]) => {
      const seen = new Map<string, Decimal>();
      for (const projectId of projectIds) {
        for (const b of billsByProject.get(projectId) ?? []) seen.set(b.id, b.outstanding);
      }
      return {
        distinctCount: seen.size,
        distinctAmount: [...seen.values()].reduce((s, v) => s.plus(v), ZERO),
      };
    };

    return { rows: allRows, distinctBills, moneyVisible, marginVisible, asOf: today.toISOString() };
  }
}
