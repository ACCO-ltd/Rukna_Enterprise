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
}
