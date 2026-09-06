import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$use' | '$extends' | '$transaction'
>;

/**
 * Reads for the project's procurement view.
 *
 * **Everything monetary comes from `CommitmentLedgerEntry`.** That table already carries
 * `projectId`, `boqNodeId`, `supplierId`, `purchaseOrderId`, `spendCategoryId`, the stage, and
 * the full source-document trace — and it is indexed on exactly `[organizationId, projectId,
 * stage]`. Re-aggregating the PO, GRN and bill tables would build a second path to the same
 * numbers, and a second path is a second answer as soon as one of them misses a reversal. The
 * ledger is the authoritative signed record; reading it means these figures cannot disagree with
 * the Project Financial Position.
 *
 * A cost with `projectId = null` is corporate overhead. It never appears here — not filtered out
 * as a preference, but excluded by every query, because a project workspace showing head-office
 * rent is simply wrong.
 */
@Injectable()
export class ProjectProcurementRepository {
  /**
   * The project's ledger totals, grouped by stage.
   *
   * `asOf` bounds on `accountingDate`, not `occurredAt`: "what had this project committed by the
   * end of September" is an accounting question, and the two dates differ whenever a document is
   * recorded late. Reversals are ordinary signed rows, so summing is the whole algorithm.
   */
  groupByStage(prisma: TenantPrisma, organizationId: string, projectId: string, asOf?: Date) {
    return prisma.commitmentLedgerEntry.groupBy({
      by: ['stage'],
      where: { organizationId, projectId, ...(asOf ? { accountingDate: { lte: asOf } } : {}) },
      _sum: { amount: true },
    });
  }

  /** Ledger totals per BOQ node (null = the project-level, non-BOQ bucket) and stage. */
  groupByBoqNodeAndStage(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    asOf?: Date,
  ) {
    return prisma.commitmentLedgerEntry.groupBy({
      by: ['boqNodeId', 'stage'],
      where: { organizationId, projectId, ...(asOf ? { accountingDate: { lte: asOf } } : {}) },
      _sum: { amount: true },
    });
  }

  groupBySupplierAndStage(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    asOf?: Date,
  ) {
    return prisma.commitmentLedgerEntry.groupBy({
      by: ['supplierId', 'stage'],
      where: { organizationId, projectId, ...(asOf ? { accountingDate: { lte: asOf } } : {}) },
      _sum: { amount: true },
    });
  }

  groupByCategoryAndStage(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    asOf?: Date,
  ) {
    return prisma.commitmentLedgerEntry.groupBy({
      by: ['spendCategoryId', 'stage'],
      where: { organizationId, projectId, ...(asOf ? { accountingDate: { lte: asOf } } : {}) },
      _sum: { amount: true },
    });
  }

  /**
   * Project-level cost by spend category — ledger rows that carry a project but **no BOQ node**.
   *
   * These are the deliberately-coded costs a BOQ has no line for: site security, transport,
   * insurance, supervision, fuel, permits. Filtering on `boqNodeId: null` is what separates them
   * from BOQ-coded cost; the project filter is what separates them from corporate overhead.
   */
  groupProjectLevelByCategory(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    asOf?: Date,
  ) {
    return prisma.commitmentLedgerEntry.groupBy({
      by: ['spendCategoryId', 'stage'],
      where: {
        organizationId,
        projectId,
        boqNodeId: null,
        ...(asOf ? { accountingDate: { lte: asOf } } : {}),
      },
      _sum: { amount: true },
    });
  }

  /** Names for the ids the groupings return, in one round trip each. */
  findSupplierNames(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.supplier.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true },
    });
  }

  findSpendCategoryNames(prisma: TenantPrisma, organizationId: string, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.spendCategory.findMany({
      where: { organizationId, id: { in: ids } },
      select: { id: true, name: true, code: true },
    });
  }

  /**
   * The project's BOQ tree from its baselined version, for rolling cost up the hierarchy.
   *
   * Cost is coded to leaves, but nobody reads a 400-line cost report — the rollup to sections is
   * what makes it usable, and it needs the parent chain to do it.
   */
  async findBoqTree(prisma: TenantPrisma, projectId: string) {
    const boq = await prisma.boq.findFirst({
      where: { projectId },
      select: {
        versions: {
          where: { status: 'BASELINED' },
          orderBy: { versionNumber: 'desc' },
          take: 1,
          select: { id: true },
        },
      },
    });
    const versionId = boq?.versions[0]?.id;
    if (!versionId) return [];
    return prisma.boqNode.findMany({
      where: { versionId },
      orderBy: [{ depth: 'asc' }, { sortOrder: 'asc' }],
      select: {
        id: true,
        parentId: true,
        code: true,
        description: true,
        depth: true,
        sortOrder: true,
        isLeaf: true,
      },
    });
  }

  /** The BASELINED cost budget with its lines, or null when the project has never set one. */
  findBaselinedBudget(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.projectCostBudget.findFirst({
      where: { organizationId, projectId, status: 'BASELINED' },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
    });
  }

  /**
   * Line totals for a set of budget versions, in one round trip.
   *
   * The version list used to report a hardcoded `'0.00'` for every row — a column of zeroes
   * beside real line counts, which reads as "these versions budget nothing" rather than as
   * "nobody computed this".
   */
  async sumBudgetTotals(
    prisma: TenantPrisma,
    budgetIds: string[],
  ): Promise<Map<string, Decimal>> {
    if (budgetIds.length === 0) return new Map();
    const rows = await prisma.projectCostBudgetLine.groupBy({
      by: ['budgetId'],
      where: { budgetId: { in: budgetIds } },
      _sum: { budgetAmount: true },
    });
    return new Map(
      rows.map((r) => [r.budgetId, new Decimal((r._sum.budgetAmount ?? 0).toString())]),
    );
  }

  findBudgets(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.projectCostBudget.findMany({
      where: { organizationId, projectId },
      orderBy: { versionNumber: 'desc' },
      include: { _count: { select: { lines: true } } },
    });
  }

  findBudgetById(prisma: TenantPrisma, organizationId: string, id: string) {
    return prisma.projectCostBudget.findFirst({
      where: { id, organizationId },
      include: {
        lines: {
          orderBy: { sortOrder: 'asc' },
          include: {
            boqNode: { select: { code: true } },
            spendCategory: { select: { name: true } },
          },
        },
      },
    });
  }

  // ─── Requirements ─────────────────────────────────────────────────────────────

  /**
   * This project's material requests with everything the list needs to show progress.
   *
   * The PO allocations come back with their PO line's unit price, because "ordered value" is the
   * allocated quantity at the price a buyer actually agreed — not the requester's estimate. Those
   * are different bases and the read model keeps them apart.
   */
  findRequirements(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.materialRequest.findMany({
      where: { organizationId, projectId },
      orderBy: [{ requestedDate: 'desc' }, { mrNumber: 'desc' }],
      include: {
        lines: {
          select: {
            id: true,
            requestedQuantity: true,
            approvedQuantity: true,
            estimatedUnitPrice: true,
            spendCategory: { select: { id: true, name: true } },
            poAllocations: {
              select: {
                allocatedQuantity: true,
                purchaseOrderLine: {
                  select: {
                    unitPrice: true,
                    revision: { select: { purchaseOrderId: true } },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /**
   * One requirement with everything the detail panel shows.
   *
   * Reaches through each line's PO allocations to the purchase order **and its revisions**,
   * because the header state and the revision lifecycle are different records and the panel must
   * render both rather than collapsing them into one "status".
   */
  findRequirementDetail(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    id: string,
  ) {
    return prisma.materialRequest.findFirst({
      where: { id, organizationId, projectId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            uom: { select: { code: true } },
            spendCategory: { select: { id: true, name: true } },
            poAllocations: {
              select: {
                allocatedQuantity: true,
                purchaseOrderLine: {
                  select: {
                    unitPrice: true,
                    boqNode: { select: { code: true, description: true } },
                    revision: {
                      select: {
                        // Also selected by the narrower list read, so one row mapper serves both.
                        purchaseOrderId: true,
                        revisionNumber: true,
                        status: true,
                        purchaseOrder: {
                          select: {
                            id: true,
                            poNumber: true,
                            status: true,
                            supplier: { select: { name: true } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  /** BOQ node codes for the requirement lines that carry one, so a line can name its target. */
  findBoqNodeLabels(prisma: TenantPrisma, ids: string[]) {
    if (ids.length === 0) return Promise.resolve([]);
    return prisma.boqNode.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, description: true },
    });
  }

  // ─── Attention ────────────────────────────────────────────────────────────────

  /**
   * Purchase orders carrying at least one line for this project, with the revision state that
   * actually governs them.
   *
   * The header status is only OPEN/CLOSED/CANCELLED; the lifecycle lives on immutable revisions,
   * so both are returned and the read model never collapses them into one "status".
   */
  findProjectPurchaseOrders(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.purchaseOrder.findMany({
      where: {
        organizationId,
        revisions: { some: { lines: { some: { projectId } } } },
      },
      select: {
        id: true,
        poNumber: true,
        status: true,
        supplier: { select: { id: true, name: true } },
        revisions: {
          orderBy: { revisionNumber: 'desc' },
          select: {
            id: true,
            revisionNumber: true,
            status: true,
            lines: { where: { projectId }, select: { id: true, extendedAmount: true } },
          },
        },
      },
    });
  }

  /** Open SoD receipt exceptions on POs that touch this project (ADR-022 CONST-DOA-004). */
  countOpenReceiptExceptions(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.poReceiptException.count({
      where: {
        organizationId,
        status: 'PENDING',
        purchaseOrder: { revisions: { some: { lines: { some: { projectId } } } } },
      },
    });
  }

  /** Supplier bills for this project sitting outside matching tolerance (ADR-018). */
  findBillsOutsideTolerance(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.supplierBill.findMany({
      where: {
        organizationId,
        matchStatus: 'EXCEPTION',
        OR: [{ projectId }, { lines: { some: { projectId } } }],
      },
      select: { id: true, billNumber: true, totalAmount: true },
    });
  }

  /** Goods-receipt lines for this project still awaiting inspection. */
  countPendingInspection(prisma: TenantPrisma, projectId: string) {
    return prisma.goodsReceiptLine.count({
      where: { qualityStatus: 'PENDING_INSPECTION', poLine: { projectId } },
    });
  }

  // ─── Activity ─────────────────────────────────────────────────────────────────

  /** The project's most recent ledger movements, newest first. */
  findRecentEntries(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    take: number,
    asOf?: Date,
  ) {
    return prisma.commitmentLedgerEntry.findMany({
      where: { organizationId, projectId, ...(asOf ? { accountingDate: { lte: asOf } } : {}) },
      orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      take,
      select: {
        id: true,
        stage: true,
        amount: true,
        currencyCode: true,
        sourceDocumentType: true,
        sourceDocumentId: true,
        sourceRevision: true,
        eventType: true,
        occurredAt: true,
        purchaseOrder: { select: { poNumber: true } },
      },
    });
  }
}
