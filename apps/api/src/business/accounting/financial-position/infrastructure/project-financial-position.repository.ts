import { Injectable } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

type TenantPrisma = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

const ZERO = new Decimal(0);

/**
 * Read-only aggregation for a project's Financial Position (ADR-013). Reads across contract / AR
 * (ClientInvoice) / commitment ledger / GL — a projection crosses those boundaries by design.
 * Every method is set-based: one query per collection, no N+1.
 */
@Injectable()
export class ProjectFinancialPositionRepository {
  /** The effective main client contract for a project — contract value and currency. */
  findMainContract(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.contract.findFirst({
      where: {
        organizationId,
        projectId,
        contractKind: 'CLIENT_CONTRACT',
        status: { notIn: ['CANCELLED', 'TERMINATED'] as never[] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, contractValue: true, currency: true },
    });
  }

  /** Net certified revenue over the contract's effective certificates (CONST-COM-003). */
  async sumCertifiedRevenue(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ): Promise<Decimal> {
    const certs = await prisma.interimPaymentCertificate.findMany({
      where: { organizationId, isEffective: true, application: { contractId } },
      select: { certifiedTotal: true, deductions: { select: { amount: true } } },
    });

    let net = ZERO;
    for (const cert of certs) {
      net = net.plus(new Decimal(cert.certifiedTotal.toString()));
      for (const ded of cert.deductions) net = net.minus(new Decimal(ded.amount.toString()));
    }
    return net;
  }

  /** Posted invoiced revenue and posted receipt allocations for the contract (CONST-COM-004). */
  async sumSettlement(
    prisma: TenantPrisma,
    organizationId: string,
    contractId: string,
  ): Promise<{ invoiced: Decimal; received: Decimal }> {
    const invoices = await prisma.clientInvoice.findMany({
      where: { organizationId, contractId, postingStatus: 'POSTED' },
      select: {
        totalAmount: true,
        allocations: { where: { postingStatus: 'POSTED' }, select: { allocatedAmount: true } },
      },
    });

    let invoiced = ZERO;
    let received = ZERO;
    for (const inv of invoices) {
      invoiced = invoiced.plus(new Decimal(inv.totalAmount.toString()));
      for (const alloc of inv.allocations) {
        received = received.plus(new Decimal(alloc.allocatedAmount.toString()));
      }
    }
    return { invoiced, received };
  }

  /**
   * Commitment-ledger totals per stage, as signed running balances.
   *
   * Returned separately rather than as one "remaining committed" figure. The two mean
   * different things — COMMITTED is ordered and not yet delivered, ACCRUED is delivered
   * and not yet billed — and only one of them is a commitment anyone can still cancel.
   * Summing them also hid a defect: because goods receipt accrues the purchase-order
   * value while a posted bill releases the bill's gross amount, the combined figure
   * goes NEGATIVE by the VAT once a project is fully billed, and "Remaining committed:
   * -$2,000" is not a number anyone can act on.
   *
   * ACTUAL is excluded from both — it is already counted in the GL actual cost.
   */
  async sumCommitmentStages(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<{ openCommitment: Decimal; accruedCost: Decimal }> {
    const rows = await prisma.commitmentLedgerEntry.groupBy({
      by: ['stage'],
      where: { organizationId, projectId, stage: { in: ['COMMITTED', 'ACCRUED'] as never[] } },
      _sum: { reportingAmount: true },
    });

    let openCommitment = ZERO;
    let accruedCost = ZERO;
    for (const row of rows) {
      const amount = new Decimal((row._sum.reportingAmount ?? 0).toString());
      if (row.stage === 'COMMITTED') openCommitment = openCommitment.plus(amount);
      else accruedCost = accruedCost.plus(amount);
    }
    return { openCommitment, accruedCost };
  }

  /**
   * Total of the project's BASELINED cost budget, or null when it has never set one.
   *
   * Null rather than zero throughout: a project with no baselined budget has no
   * denominator, and every ratio built on it must be absent rather than 0%.
   */
  async sumBaselinedBudget(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<{ total: Decimal; currency: string } | null> {
    const budget = await prisma.projectCostBudget.findFirst({
      where: { organizationId, projectId, status: 'BASELINED' },
      select: { currency: true, lines: { select: { budgetAmount: true } } },
    });
    if (!budget) return null;

    let total = ZERO;
    for (const line of budget.lines) {
      total = total.plus(new Decimal(line.budgetAmount.toString()));
    }
    return { total, currency: budget.currency };
  }

  /**
   * Posted GL cost attributed to the project, project-to-date: the debit-normal balance
   * (debit − credit) of POSTED, non-CLOSING journal lines carrying this projectId on accounts
   * whose current version is COST_OF_SALES or EXPENSE.
   */
  async sumActualCost(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<Decimal> {
    const accounts = await prisma.account.findMany({
      where: { organizationId },
      select: { id: true, versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });

    const costAccountIds = accounts
      .filter((a) => {
        const cls = a.versions[0]?.accountClass;
        return cls === 'COST_OF_SALES' || cls === 'EXPENSE';
      })
      .map((a) => a.id);

    if (costAccountIds.length === 0) return ZERO;

    const agg = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: costAccountIds },
        projectId,
        entry: { organizationId, status: 'POSTED', entryPurpose: { not: 'CLOSING' } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    let total = ZERO;
    for (const row of agg) {
      total = total
        .plus(new Decimal((row._sum.debitAmount ?? 0).toString()))
        .minus(new Decimal((row._sum.creditAmount ?? 0).toString()));
    }
    return total;
  }

  // ─── Reconciliation ───────────────────────────────────────────────────────────

  /** Commitment-ledger ACTUAL for the project — the procurement side of REC-01. */
  async sumLedgerActual(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<Decimal> {
    const agg = await prisma.commitmentLedgerEntry.aggregate({
      where: { organizationId, projectId, stage: 'ACTUAL' },
      _sum: { reportingAmount: true },
    });
    return new Decimal((agg._sum.reportingAmount ?? 0).toString());
  }

  /**
   * Posted project cost split by where it came from.
   *
   * The split is the whole point: only supplier-bill-originated cost can be compared with
   * procurement's ACTUAL. Payroll, plant, depreciation and manual accruals are real project
   * cost that procurement never sees, and folding them into the comparison would report a
   * variance every time someone journals a legitimate cost.
   */
  async sumActualCostBySource(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<{ fromSupplierBills: Decimal; fromOtherSources: Decimal }> {
    const costAccountIds = await this.costAccountIds(prisma, organizationId);
    if (costAccountIds.length === 0) {
      return { fromSupplierBills: ZERO, fromOtherSources: ZERO };
    }

    const rows = await prisma.journalLine.groupBy({
      by: ['journalEntryId'],
      where: {
        accountId: { in: costAccountIds },
        projectId,
        entry: { organizationId, status: 'POSTED', entryPurpose: { not: 'CLOSING' } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });
    if (rows.length === 0) return { fromSupplierBills: ZERO, fromOtherSources: ZERO };

    const entries = await prisma.journalEntry.findMany({
      where: { id: { in: rows.map((r) => r.journalEntryId) } },
      select: { id: true, sourceDocumentType: true },
    });
    const sourceById = new Map(entries.map((e) => [e.id, e.sourceDocumentType]));

    let fromSupplierBills = ZERO;
    let fromOtherSources = ZERO;
    for (const row of rows) {
      const net = new Decimal((row._sum.debitAmount ?? 0).toString()).minus(
        new Decimal((row._sum.creditAmount ?? 0).toString()),
      );
      if (sourceById.get(row.journalEntryId) === 'SUPPLIER_BILL') {
        fromSupplierBills = fromSupplierBills.plus(net);
      } else {
        fromOtherSources = fromOtherSources.plus(net);
      }
    }
    return { fromSupplierBills, fromOtherSources };
  }

  /**
   * Posted bill lines that belong to this project's procurement but reached the GL with no
   * project on them — cost the accounts have lost. The likeliest cause of a variance.
   */
  async countUnattributedBillLines(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<number> {
    return prisma.supplierBillLine.count({
      where: {
        projectId: null,
        bill: { organizationId, postingStatus: 'POSTED' },
        purchaseOrderLineId: { not: null },
        // Reached via the PO line, which is where the project attribution actually lives.
        OR: [{ bill: { projectId } }, { bill: { lines: { some: { projectId } } } }],
      },
    });
  }

  /** Accounts whose current version is a cost class. Shared by the cost reads above. */
  private async costAccountIds(prisma: TenantPrisma, organizationId: string): Promise<string[]> {
    const accounts = await prisma.account.findMany({
      where: {
        organizationId,
        versions: {
          some: { accountClass: { in: ['COST_OF_SALES', 'EXPENSE'] as never[] } },
        },
      },
      select: { id: true, versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });
    return accounts
      .filter((a) => {
        const cls = a.versions[0]?.accountClass;
        return cls === 'COST_OF_SALES' || cls === 'EXPENSE';
      })
      .map((a) => a.id);
  }

  // ─── Finance Overview ─────────────────────────────────────────────────────────

  /** Posted revenue carrying this project: credit-normal, excluding CLOSING entries. */
  async sumPostedRevenue(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<Decimal> {
    const accounts = await prisma.account.findMany({
      where: {
        organizationId,
        versions: { some: { accountClass: 'INCOME' as never } },
      },
      select: { id: true, versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });
    const incomeIds = accounts
      .filter((a) => a.versions[0]?.accountClass === 'INCOME')
      .map((a) => a.id);
    if (incomeIds.length === 0) return ZERO;

    const agg = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: incomeIds },
        projectId,
        entry: { organizationId, status: 'POSTED', entryPurpose: { not: 'CLOSING' } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    let total = ZERO;
    for (const row of agg) {
      total = total
        .plus(new Decimal((row._sum.creditAmount ?? 0).toString()))
        .minus(new Decimal((row._sum.debitAmount ?? 0).toString()));
    }
    return total;
  }

  /** Every cost-budget version for the project, newest first. */
  findBudgetVersions(prisma: TenantPrisma, organizationId: string, projectId: string) {
    return prisma.projectCostBudget.findMany({
      where: { organizationId, projectId },
      orderBy: { versionNumber: 'desc' },
      select: {
        id: true,
        versionNumber: true,
        status: true,
        baselinedAt: true,
        baselinedBy: true,
      },
    });
  }

  /** The accounting period covering today, or null when the calendar does not reach it. */
  findCurrentPeriod(prisma: TenantPrisma, organizationId: string) {
    const today = new Date();
    return prisma.accountingPeriod.findFirst({
      where: { organizationId, startDate: { lte: today }, endDate: { gte: today } },
      orderBy: { startDate: 'desc' },
      select: { id: true, name: true, status: true, endDate: true },
    });
  }

  /**
   * Approved supplier bills touching this project that have not reached the ledger.
   *
   * Cost the project has incurred and agreed but the accounts do not yet show — the most common
   * honest reason for actual cost to look lower than a site manager expects.
   */
  async countApprovedUnpostedBills(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
  ): Promise<{ count: number; total: Decimal }> {
    const bills = await prisma.supplierBill.findMany({
      where: {
        organizationId,
        documentStatus: 'APPROVED',
        postingStatus: { in: ['NOT_POSTED', 'FAILED'] },
        OR: [{ projectId }, { lines: { some: { projectId } } }],
      },
      select: { totalAmount: true },
    });
    return {
      count: bills.length,
      total: bills.reduce((sum, b) => sum.plus(new Decimal(b.totalAmount.toString())), ZERO),
    };
  }

  /**
   * Recent posted journals that moved this project, with the net movement attributed to it.
   *
   * The amount is the project's own share of the entry, not the journal total: a bill covering
   * three projects should not report its full value against each of them.
   */
  async findRecentProjectPostings(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    take: number,
  ) {
    const lines = await prisma.journalLine.findMany({
      where: { projectId, entry: { organizationId, status: 'POSTED' } },
      orderBy: [{ entry: { accountingDate: 'desc' } }, { entry: { journalNumber: 'desc' } }],
      // Enough lines to cover `take` distinct entries even when an entry has several.
      take: take * 6,
      select: {
        debitAmount: true,
        creditAmount: true,
        entry: {
          select: {
            id: true,
            journalNumber: true,
            accountingDate: true,
            description: true,
            sourceDocumentType: true,
            sourceDocumentId: true,
          },
        },
      },
    });

    const byEntry = new Map<
      string,
      {
        id: string;
        journalNumber: string | null;
        accountingDate: Date;
        description: string;
        sourceDocumentType: string | null;
        sourceDocumentId: string | null;
        projectAmount: Decimal;
      }
    >();
    for (const line of lines) {
      const existing = byEntry.get(line.entry.id);
      const movement = new Decimal(line.debitAmount.toString()).minus(
        new Decimal(line.creditAmount.toString()),
      );
      if (existing) {
        existing.projectAmount = existing.projectAmount.plus(movement);
      } else {
        byEntry.set(line.entry.id, { ...line.entry, projectAmount: movement });
      }
    }
    return [...byEntry.values()].slice(0, take);
  }

  /** Cost-budget lifecycle events for this project, from the audit trail. */
  async findRecentBudgetEvents(
    prisma: TenantPrisma,
    organizationId: string,
    projectId: string,
    take: number,
  ) {
    const budgets = await prisma.projectCostBudget.findMany({
      where: { organizationId, projectId },
      select: { id: true },
    });
    if (budgets.length === 0) return [];

    return prisma.auditLog.findMany({
      where: {
        orgId: organizationId,
        resource: 'ProjectCostBudget',
        resourceId: { in: budgets.map((b) => b.id) },
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, action: true, createdAt: true, resourceId: true },
    });
  }
}
