import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type ProcurementAttentionItem,
  type ProjectCostByCategoryRow,
  type ProjectCostBySupplierRow,
  type ProjectProcurementActivityRow,
  type ProjectProcurementCapabilities,
  type ProjectProcurementCostResponse,
  type ProjectProcurementOverviewResponse,
  type ProjectProcurementPipelineStage,
  type ProjectRequirementRow,
  type ProjectRequirementsResponse,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { ProjectAccessService } from '../../../../platform/project-access/project-access.service.js';
import { ProjectProcurementRepository } from '../infrastructure/project-procurement.repository.js';
import {
  ZERO,
  addStage,
  buildPosition,
  emptyStageTotals,
  rollUpCostByBoq,
  type StageTotals,
} from '../domain/project-cost-rollup.js';

/** The project-level bucket's label. Data, not a translation key — the UI localises the row. */
const PROJECT_LEVEL_LABEL = 'Project-level (non-BOQ)';

/** How many days a DRAFT requirement may sit before it counts as stale. */
const STALE_DRAFT_DAYS = 14;

@Injectable()
export class ProjectProcurementService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly projectAccess: ProjectAccessService,
    private readonly repo: ProjectProcurementRepository,
  ) {}

  // ─── Overview ─────────────────────────────────────────────────────────────────

  /**
   * The project's procurement control page.
   *
   * Reads the commitment ledger for every figure, then names the documents behind them. It never
   * presents a supplier document as project-owned: a purchase order appears here as the source of
   * a cost, with a link out to the buyer's workspace where it is actually operated.
   */
  async getOverview(
    identity: RequestIdentity,
    projectId: string,
    asOf?: Date,
  ): Promise<ProjectProcurementOverviewResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const asOfIso = (asOf ?? new Date()).toISOString();

    const [stageRows, budget, boqRows, supplierRows, requirements, purchaseOrders, entries] =
      await Promise.all([
        this.repo.groupByStage(prisma, orgId, projectId, asOf),
        this.repo.findBaselinedBudget(prisma, orgId, projectId),
        this.repo.groupByBoqNodeAndStage(prisma, orgId, projectId, asOf),
        this.repo.groupBySupplierAndStage(prisma, orgId, projectId, asOf),
        this.repo.findRequirements(prisma, orgId, projectId),
        this.repo.findProjectPurchaseOrders(prisma, orgId, projectId),
        this.repo.findRecentEntries(prisma, orgId, projectId, 8, asOf),
      ]);

    const totals = emptyStageTotals();
    for (const row of stageRows) {
      addStage(totals, row.stage, new Decimal(row._sum.amount?.toString() ?? 0));
    }
    const budgetTotal = budget
      ? budget.lines.reduce((sum, l) => sum.plus(new Decimal(l.budgetAmount.toString())), ZERO)
      : null;
    const currency = budget?.currency ?? entries[0]?.currencyCode ?? null;

    const rows = requirements.map((mr) => this.toRequirementRow(mr, mayViewFinancials));
    const attention = await this.buildAttention(
      prisma,
      orgId,
      projectId,
      rows,
      requirements,
      identity,
      mayViewFinancials,
    );

    // "Active" is the header being OPEN — the revisions carry their own lifecycle and a PO can be
    // open with a draft revision in flight. Value is this project's share of its active revision,
    // never the whole order: the other lines belong to other sites.
    // `PurchaseOrder.status = OPEN`, and called that. "Active" would blur the header state into
    // the revision lifecycle, which is a different record — the same conflation that makes a
    // reader believe an order is approved when only its header is open.
    const openPos = purchaseOrders.filter((po) => po.status === 'OPEN');
    let openPoValue = ZERO;
    for (const po of openPos) {
      const activeRevision = po.revisions.find((r) => r.status === 'ACTIVE') ?? po.revisions[0];
      for (const line of activeRevision?.lines ?? []) {
        openPoValue = openPoValue.plus(new Decimal(line.extendedAmount.toString()));
      }
    }

    // Open = still wanting something. Approved-and-fully-ordered is done; cancelled and closed
    // are gone. Read from the split statuses so the two questions stay separate.
    const openRequirements = rows.filter(
      (r) =>
        !['CANCELLED', 'CLOSED'].includes(r.approvalStatus) &&
        r.fulfillmentStatus !== 'FULLY_ORDERED',
    );
    // The site-blocking set: agreed, and nobody has ordered any of it.
    const awaitingProcurement = rows.filter(
      (r) => r.approvalStatus === 'APPROVED' && r.fulfillmentStatus === 'NOT_ORDERED',
    );

    const boqTree = await this.repo.findBoqTree(prisma, projectId);
    const { costByNode } = this.indexByNode(boqRows);
    const budgetByNode = this.budgetByNode(budget);

    return {
      projectId,
      financialsVisible: mayViewFinancials,
      position: buildPosition(totals, budgetTotal, currency, mayViewFinancials),
      openRequirementCount: openRequirements.length,
      requirementsAwaitingProcurement: awaitingProcurement.length,
      openPoCount: openPos.length,
      openPoValue: mayViewFinancials ? openPoValue.toFixed(2) : null,
      openExceptionCount: attention
        .filter((a) => a.tier === 'SITE_BLOCKING' || a.tier === 'FINANCIAL_CONTROL')
        .reduce((sum, a) => sum + a.count, 0),
      pipeline: this.buildPipeline(rows, openPos.length, openPoValue, totals, mayViewFinancials),
      attention,
      // The overview chart wants sections, not the whole tree — depth 0 only.
      costByBoq: rollUpCostByBoq({
        nodes: boqTree,
        costByNode,
        budgetByNode,
        projectLevelLabel: PROJECT_LEVEL_LABEL,
        mayViewFinancials,
      }).filter((r) => r.depth === 0),
      committedBySupplier: await this.buildBySupplier(
        prisma,
        orgId,
        supplierRows,
        totals.committed,
        mayViewFinancials,
      ),
      recentActivity: entries.map((e) => this.toActivityRow(e, mayViewFinancials)),
      capabilities: this.capabilities(identity),
      asOf: asOfIso,
    };
  }

  // ─── Cost & commitments ───────────────────────────────────────────────────────

  async getCost(
    identity: RequestIdentity,
    projectId: string,
    asOf?: Date,
  ): Promise<ProjectProcurementCostResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);
    const asOfIso = (asOf ?? new Date()).toISOString();

    const [stageRows, budget, boqRows, supplierRows, categoryRows, boqTree, entries, projectLevelRows] =
      await Promise.all([
        this.repo.groupByStage(prisma, orgId, projectId, asOf),
        this.repo.findBaselinedBudget(prisma, orgId, projectId),
        this.repo.groupByBoqNodeAndStage(prisma, orgId, projectId, asOf),
        this.repo.groupBySupplierAndStage(prisma, orgId, projectId, asOf),
        this.repo.groupByCategoryAndStage(prisma, orgId, projectId, asOf),
        this.repo.findBoqTree(prisma, projectId),
        this.repo.findRecentEntries(prisma, orgId, projectId, 10, asOf),
        this.repo.groupProjectLevelByCategory(prisma, orgId, projectId, asOf),
      ]);

    const totals = emptyStageTotals();
    for (const row of stageRows) {
      addStage(totals, row.stage, new Decimal(row._sum.amount?.toString() ?? 0));
    }
    const budgetTotal = budget
      ? budget.lines.reduce((sum, l) => sum.plus(new Decimal(l.budgetAmount.toString())), ZERO)
      : null;
    const currency = budget?.currency ?? entries[0]?.currencyCode ?? null;
    const { costByNode } = this.indexByNode(boqRows);

    return {
      projectId,
      financialsVisible: mayViewFinancials,
      position: buildPosition(totals, budgetTotal, currency, mayViewFinancials),
      budgetVersion: budget?.versionNumber ?? null,
      byBoq: rollUpCostByBoq({
        nodes: boqTree,
        costByNode,
        budgetByNode: this.budgetByNode(budget),
        projectLevelLabel: PROJECT_LEVEL_LABEL,
        mayViewFinancials,
        projectLevelByCategory: await this.buildProjectLevelCategories(
          prisma,
          orgId,
          projectLevelRows,
          budget,
        ),
      }),
      bySupplier: await this.buildBySupplier(
        prisma,
        orgId,
        supplierRows,
        totals.committed,
        mayViewFinancials,
      ),
      byCategory: await this.buildByCategory(
        prisma,
        orgId,
        categoryRows,
        totals.actual,
        mayViewFinancials,
      ),
      recentEntries: entries.map((e) => this.toActivityRow(e, mayViewFinancials)),
      capabilities: this.capabilities(identity),
      asOf: asOfIso,
    };
  }

  // ─── Requirements ─────────────────────────────────────────────────────────────

  async getRequirements(
    identity: RequestIdentity,
    projectId: string,
  ): Promise<ProjectRequirementsResponse> {
    await this.projectAccess.assertMember(identity, projectId);
    const prisma = this.tenancy.getClient();
    const mayViewFinancials = identity.permissions.includes(PERMISSIONS.financialPositionView);

    const requests = await this.repo.findRequirements(
      prisma,
      identity.activeOrganizationId,
      projectId,
    );
    const rows = requests.map((mr) => this.toRequirementRow(mr, mayViewFinancials));

    return {
      projectId,
      financialsVisible: mayViewFinancials,
      summary: {
        total: rows.length,
        // Approved and not yet ordered — the set a buyer should be working from.
        approved: rows.filter(
          (r) => r.approvalStatus === 'APPROVED' && r.fulfillmentStatus === 'NOT_ORDERED',
        ).length,
        ordered: rows.filter((r) => r.fulfillmentStatus === 'FULLY_ORDERED').length,
        partiallyOrdered: rows.filter((r) => r.fulfillmentStatus === 'PARTIALLY_ORDERED').length,
        draftOrOther: rows.filter((r) =>
          ['DRAFT', 'SUBMITTED', 'CANCELLED', 'CLOSED'].includes(r.approvalStatus),
        ).length,
      },
      requirements: rows,
      capabilities: this.capabilities(identity),
      asOf: new Date().toISOString(),
    };
  }

  // ─── Internal ─────────────────────────────────────────────────────────────────

  private capabilities(identity: RequestIdentity): ProjectProcurementCapabilities {
    const has = (p: string) => identity.permissions.includes(p);
    return {
      canViewFinancials: has(PERMISSIONS.financialPositionView),
      canRaiseRequirement: has(PERMISSIONS.materialRequestsCreate),
      canManageBudget: has(PERMISSIONS.projectBudgetManage),
      canBaselineBudget: has(PERMISSIONS.projectBudgetBaseline),
      // Buyer authority. The project tab still links out rather than duplicating the PO form —
      // one canonical buyer workflow — but a reader without this should not be offered the link
      // as though they could act on it.
      canOperateProcurement: has(PERMISSIONS.purchaseOrdersCreate),
    };
  }

  private indexByNode(
    rows: Array<{ boqNodeId: string | null; stage: string; _sum: { amount: Decimal | null } }>,
  ) {
    const costByNode = new Map<string | null, StageTotals>();
    for (const row of rows) {
      const totals = costByNode.get(row.boqNodeId) ?? emptyStageTotals();
      addStage(totals, row.stage as never, new Decimal(row._sum.amount?.toString() ?? 0));
      costByNode.set(row.boqNodeId, totals);
    }
    return { costByNode };
  }

  private budgetByNode(
    budget: { lines: Array<{ boqNodeId: string | null; budgetAmount: Decimal }> } | null,
  ): Map<string | null, Decimal> {
    const map = new Map<string | null, Decimal>();
    for (const line of budget?.lines ?? []) {
      const key = line.boqNodeId;
      map.set(key, (map.get(key) ?? ZERO).plus(new Decimal(line.budgetAmount.toString())));
    }
    return map;
  }

  /**
   * Project-level cost and budget, per spend category.
   *
   * Both sides key on the same `spendCategoryId`, which is exactly what makes the budget
   * consumable: a category budgeted at $40,000 and a purchase order coded to that category meet
   * on the same row. Categories appear when either side has something — a budget with no spend
   * yet is as worth showing as spend against no budget.
   */
  private async buildProjectLevelCategories(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    categoryRows: Array<{
      spendCategoryId: string | null;
      stage: string;
      _sum: { amount: Decimal | null };
    }>,
    budget: { lines: Array<{ boqNodeId: string | null; spendCategoryId: string | null; budgetAmount: Decimal }> } | null,
  ) {
    const costByCategory = new Map<string, StageTotals>();
    for (const row of categoryRows) {
      // A project-level ledger row with no category cannot be named, so it stays in the parent
      // total rather than becoming an "unallocated" child that implies a coding failure.
      if (!row.spendCategoryId) continue;
      const totals = costByCategory.get(row.spendCategoryId) ?? emptyStageTotals();
      addStage(totals, row.stage as never, new Decimal(row._sum.amount?.toString() ?? 0));
      costByCategory.set(row.spendCategoryId, totals);
    }

    const budgetByCategory = new Map<string, Decimal>();
    for (const line of budget?.lines ?? []) {
      if (line.boqNodeId || !line.spendCategoryId) continue;
      budgetByCategory.set(
        line.spendCategoryId,
        (budgetByCategory.get(line.spendCategoryId) ?? ZERO).plus(
          new Decimal(line.budgetAmount.toString()),
        ),
      );
    }

    const ids = [...new Set([...costByCategory.keys(), ...budgetByCategory.keys()])];
    if (ids.length === 0) return [];
    const names = new Map<string, string>(
      (await this.repo.findSpendCategoryNames(prisma, orgId, ids)).map(
        (c) => [c.id, c.name] as const,
      ),
    );

    return ids
      .map((spendCategoryId) => ({
        spendCategoryId,
        name: names.get(spendCategoryId) ?? 'Unknown category',
        cost: costByCategory.get(spendCategoryId) ?? null,
        budget: budgetByCategory.get(spendCategoryId) ?? null,
      }))
      .sort((a, b) => Number(b.cost?.committed ?? 0) - Number(a.cost?.committed ?? 0));
  }

  /**
   * Requirement → payment, as five counts and five amounts.
   *
   * Each stage's money comes from the stage that actually owns it: orders from the PO lines,
   * received from the ledger's ACCRUED, billed from ACTUAL. Payments are not in the commitment
   * ledger at all — paying a bill moves cash, not cost — so the count and value are deliberately
   * absent rather than guessed from ACTUAL.
   */
  private buildPipeline(
    requirements: ProjectRequirementRow[],
    openPoCount: number,
    openPoValue: Decimal,
    totals: StageTotals,
    mayViewFinancials: boolean,
  ): ProjectProcurementPipelineStage[] {
    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);
    return [
      {
        stage: 'REQUIREMENTS',
        count: requirements.length,
        amount: null,
        qualifierCount: requirements.filter(
          (r) => r.approvalStatus === 'APPROVED' && r.fulfillmentStatus === 'NOT_ORDERED',
        ).length,
      },
      {
        stage: 'PURCHASE_ORDERS',
        count: openPoCount,
        amount: money(openPoValue),
        qualifierCount: null,
      },
      { stage: 'GOODS_RECEIVED', count: 0, amount: money(totals.accrued), qualifierCount: null },
      { stage: 'SUPPLIER_BILLS', count: 0, amount: money(totals.actual), qualifierCount: null },
      // Payment settles a liability; it is not a fourth cost stage, and it is not in the
      // commitment ledger at all. So this stage carries a count and **no amount** — inferring
      // one from ACTUAL would report money as paid that nobody has paid.
      { stage: 'PAYMENTS', count: 0, amount: null, qualifierCount: null },
    ];
  }

  /**
   * What needs doing, ordered by operational consequence.
   *
   * The tiers are the product's, not the database's: whether the site can keep working outranks
   * whether a bill reconciles, and a stale draft never outranks either. Classifying server-side
   * means every surface sorts the same way and no UI invents a severity engine of its own.
   */
  private async buildAttention(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    projectId: string,
    rows: ProjectRequirementRow[],
    requests: Array<{ status: string; requestedDate: Date; priority: string }>,
    identity: RequestIdentity,
    mayViewFinancials: boolean,
  ): Promise<ProcurementAttentionItem[]> {
    const base = `/projects/${projectId}/procurement`;
    const canSeeProcurement = identity.permissions.includes(PERMISSIONS.procurementView);

    type BillRow = { id: string; billNumber: string | null; totalAmount: Decimal };
    // A failure in any one of these is a missing badge, not a missing page: the attention queue
    // degrades to what it could read rather than taking the overview down with it.
    const [overReceipt, bills, pendingInspection] = await Promise.all([
      this.repo.countOpenReceiptExceptions(prisma, orgId, projectId).catch(() => 0),
      this.repo
        .findBillsOutsideTolerance(prisma, orgId, projectId)
        .catch(() => [] as BillRow[]) as Promise<BillRow[]>,
      this.repo.countPendingInspection(prisma, projectId).catch(() => 0),
    ]);

    const items: ProcurementAttentionItem[] = [];
    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);

    // P1 — the site cannot proceed. An approved requirement nobody has ordered is the single
    // most common reason work stops, which is why it leads.
    const notOrdered = rows.filter(
      (r) => r.approvalStatus === 'APPROVED' && r.fulfillmentStatus === 'NOT_ORDERED',
    );
    if (notOrdered.length > 0) {
      items.push({
        kind: 'APPROVED_NOT_ORDERED',
        tier: 'SITE_BLOCKING',
        count: notOrdered.length,
        amount: money(
          notOrdered.reduce((sum, r) => sum.plus(new Decimal(r.remainingValue ?? 0)), ZERO),
        ),
        actionUrl: `${base}/requirements`,
      });
    }
    if (overReceipt > 0) {
      items.push({
        kind: 'OVER_RECEIPT_EXCEPTION',
        tier: 'SITE_BLOCKING',
        count: overReceipt,
        amount: null,
        actionUrl: canSeeProcurement ? '/procurement/grn' : null,
      });
    }

    // P2 — cost has landed but is not recognised. Accrued exceeding actual is exactly "received
    // and not yet billed": the goods are on site and the liability is not on the books.
    if (pendingInspection > 0) {
      items.push({
        kind: 'INSPECTION_UNRESOLVED',
        tier: 'COST_RECOGNITION',
        count: pendingInspection,
        amount: null,
        actionUrl: canSeeProcurement ? '/procurement/grn' : null,
      });
    }

    // P3 — financial control.
    if (bills.length > 0) {
      items.push({
        kind: 'BILL_OUTSIDE_TOLERANCE',
        tier: 'FINANCIAL_CONTROL',
        count: bills.length,
        amount: money(
          bills.reduce((sum, b) => sum.plus(new Decimal(b.totalAmount.toString())), ZERO),
        ),
        actionUrl: canSeeProcurement ? '/finance/accounting/bills' : null,
      });
    }

    // P4 — hygiene. Real, and never allowed to outrank the three above.
    const staleCutoff = new Date(Date.now() - STALE_DRAFT_DAYS * 86_400_000);
    const staleDrafts = requests.filter(
      (r) => r.status === 'DRAFT' && r.requestedDate < staleCutoff,
    );
    if (staleDrafts.length > 0) {
      items.push({
        kind: 'STALE_DRAFT_REQUIREMENT',
        tier: 'ROUTINE',
        count: staleDrafts.length,
        amount: null,
        actionUrl: `${base}/requirements`,
      });
    }

    const order = { SITE_BLOCKING: 0, COST_RECOGNITION: 1, FINANCIAL_CONTROL: 2, ROUTINE: 3 };
    return items.sort((a, b) => order[a.tier] - order[b.tier]);
  }

  private async buildBySupplier(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    rows: Array<{ supplierId: string | null; stage: string; _sum: { amount: Decimal | null } }>,
    committedTotal: Decimal,
    mayViewFinancials: boolean,
  ): Promise<ProjectCostBySupplierRow[]> {
    const bySupplier = new Map<string | null, StageTotals>();
    for (const row of rows) {
      const totals = bySupplier.get(row.supplierId) ?? emptyStageTotals();
      addStage(totals, row.stage as never, new Decimal(row._sum.amount?.toString() ?? 0));
      bySupplier.set(row.supplierId, totals);
    }
    const ids = [...bySupplier.keys()].filter((id): id is string => id !== null);
    const names = new Map<string, string>(
      (await this.repo.findSupplierNames(prisma, orgId, ids)).map((s) => [s.id, s.name] as const),
    );
    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);

    return [...bySupplier.entries()]
      .map(([supplierId, totals]) => ({
        supplierId,
        // A ledger row with no supplier is a cost that arrived without one — a migration entry
        // or an adjustment. It is named, not hidden, so the column still reconciles to the total.
        supplierName: supplierId ? (names.get(supplierId) ?? 'Unknown supplier') : 'Unattributed',
        committed: money(totals.committed),
        accrued: money(totals.accrued),
        actual: money(totals.actual),
        percentOfCommitted:
          mayViewFinancials && committedTotal.gt(ZERO)
            ? Math.round(totals.committed.div(committedTotal).mul(1000).toNumber()) / 10
            : null,
      }))
      .sort((a, b) => Number(b.committed ?? 0) - Number(a.committed ?? 0));
  }

  private async buildByCategory(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    rows: Array<{ spendCategoryId: string | null; stage: string; _sum: { amount: Decimal | null } }>,
    actualTotal: Decimal,
    mayViewFinancials: boolean,
  ): Promise<ProjectCostByCategoryRow[]> {
    const byCategory = new Map<string | null, StageTotals>();
    for (const row of rows) {
      const totals = byCategory.get(row.spendCategoryId) ?? emptyStageTotals();
      addStage(totals, row.stage as never, new Decimal(row._sum.amount?.toString() ?? 0));
      byCategory.set(row.spendCategoryId, totals);
    }
    const ids = [...byCategory.keys()].filter((id): id is string => id !== null);
    const names = new Map<string, string>(
      (await this.repo.findSpendCategoryNames(prisma, orgId, ids)).map(
        (c) => [c.id, c.name] as const,
      ),
    );
    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);

    return [...byCategory.entries()]
      .map(([spendCategoryId, totals]) => ({
        spendCategoryId,
        categoryName: spendCategoryId
          ? (names.get(spendCategoryId) ?? 'Unknown category')
          : 'Uncategorised',
        committed: money(totals.committed),
        accrued: money(totals.accrued),
        actual: money(totals.actual),
        percentOfActual:
          mayViewFinancials && actualTotal.gt(ZERO)
            ? Math.round(totals.actual.div(actualTotal).mul(1000).toNumber()) / 10
            : null,
      }))
      .sort((a, b) => Number(b.actual ?? 0) - Number(a.actual ?? 0));
  }

  /**
   * One requirement, with its estimate and what has actually been ordered against it.
   *
   * The two are different bases and stay apart: `estimatedValue` is the requester's figure (what
   * ADR-022 routes approval on), `orderedValue` is allocated quantity at the price a buyer
   * agreed. Their difference is not a saving — a buyer beating an estimate and a buyer
   * part-ordering look identical in a single number.
   */
  private toRequirementRow(
    mr: {
      id: string;
      mrNumber: string;
      title: string | null;
      description: string | null;
      status: string;
      priority: string;
      currencyCode: string | null;
      requestedDate: Date;
      requiredByDate: Date | null;
      lines: Array<{
        requestedQuantity: Decimal;
        approvedQuantity: Decimal | null;
        estimatedUnitPrice: Decimal | null;
        spendCategory: { id: string; name: string } | null;
        poAllocations: Array<{
          allocatedQuantity: Decimal;
          purchaseOrderLine: { unitPrice: Decimal; revision: { purchaseOrderId: string } };
        }>;
      }>;
    },
    mayViewFinancials: boolean,
  ): ProjectRequirementRow {
    let estimated = ZERO;
    let hasEstimate = false;
    let ordered = ZERO;
    const purchaseOrderIds = new Set<string>();
    const categories = new Set<string>();

    for (const line of mr.lines) {
      if (line.estimatedUnitPrice !== null) {
        hasEstimate = true;
        const qty = new Decimal((line.approvedQuantity ?? line.requestedQuantity).toString());
        estimated = estimated.plus(qty.mul(new Decimal(line.estimatedUnitPrice.toString())));
      }
      if (line.spendCategory) categories.add(line.spendCategory.name);
      for (const allocation of line.poAllocations) {
        ordered = ordered.plus(
          new Decimal(allocation.allocatedQuantity.toString()).mul(
            new Decimal(allocation.purchaseOrderLine.unitPrice.toString()),
          ),
        );
        purchaseOrderIds.add(allocation.purchaseOrderLine.revision.purchaseOrderId);
      }
    }

    const money = (d: Decimal): string | null => (mayViewFinancials ? d.toFixed(2) : null);

    // Two facts out of one enum. `PARTIALLY_ORDERED` and `FULLY_ORDERED` are fulfilment states
    // that say nothing about approval — a request cannot be ordered without having been approved,
    // so the approval side reads APPROVED for both rather than losing it.
    const approvalStatus: ProjectRequirementRow['approvalStatus'] =
      mr.status === 'PARTIALLY_ORDERED' || mr.status === 'FULLY_ORDERED'
        ? 'APPROVED'
        : (mr.status as ProjectRequirementRow['approvalStatus']);
    // Fulfilment from the allocations themselves rather than the status word, so a request whose
    // status has not caught up with its purchase orders still reads honestly.
    const fulfillmentStatus: ProjectRequirementRow['fulfillmentStatus'] =
      mr.status === 'FULLY_ORDERED'
        ? 'FULLY_ORDERED'
        : ordered.gt(ZERO) || mr.status === 'PARTIALLY_ORDERED'
          ? 'PARTIALLY_ORDERED'
          : 'NOT_ORDERED';

    return {
      id: mr.id,
      mrNumber: mr.mrNumber,
      title: mr.title,
      description: mr.description,
      status: mr.status,
      approvalStatus,
      fulfillmentStatus,
      priority: mr.priority as ProjectRequirementRow['priority'],
      // One category when the lines agree, "Mixed" when they do not — a request spanning
      // materials and subcontract is a real thing and picking one of them would be a lie.
      category:
        categories.size === 0 ? null : categories.size === 1 ? [...categories][0]! : 'Mixed',
      requestedDate: mr.requestedDate.toISOString(),
      requiredByDate: mr.requiredByDate?.toISOString() ?? null,
      lineCount: mr.lines.length,
      // Only where there is an amount to denominate — a currency beside no figure is noise.
      currencyCode: hasEstimate ? mr.currencyCode : null,
      estimatedValue: hasEstimate ? money(estimated) : null,
      orderedValue: money(ordered),
      remainingValue: hasEstimate ? money(Decimal.max(ZERO, estimated.minus(ordered))) : null,
      purchaseOrderCount: purchaseOrderIds.size,
    };
  }

  /**
   * A ledger movement, named by the document that caused it.
   *
   * The reference is the PO number where the ledger has one; otherwise the source document type
   * and its revision. It is never the raw cuid — a database id in a reference column is not a
   * reference, it is a leak.
   */
  private toActivityRow(
    entry: {
      id: string;
      stage: string;
      amount: Decimal;
      currencyCode: string;
      sourceDocumentType: string;
      sourceRevision: number | null;
      eventType: string;
      occurredAt: Date;
      purchaseOrder: { poNumber: string } | null;
    },
    mayViewFinancials: boolean,
  ): ProjectProcurementActivityRow {
    const reference = entry.purchaseOrder
      ? entry.sourceRevision !== null
        ? `${entry.purchaseOrder.poNumber} (Rev ${entry.sourceRevision})`
        : entry.purchaseOrder.poNumber
      : null;

    return {
      id: entry.id,
      documentType: entry.sourceDocumentType,
      reference,
      description: entry.eventType,
      amount: mayViewFinancials ? new Decimal(entry.amount.toString()).toFixed(2) : null,
      currency: entry.currencyCode,
      stage: entry.stage as ProjectProcurementActivityRow['stage'],
      occurredAt: entry.occurredAt.toISOString(),
    };
  }
}
