import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

export interface PLLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountClass: string;
  accountSubtype: string;
  amount: string;
}

export interface PLSection {
  label: string;
  total: string;
  lines: PLLine[];
}

export interface PLReportResult {
  fromDate: string;
  toDate: string;
  organizationId: string;
  projectId?: string;
  departmentId?: string;
  generatedAt: string;
  revenue: PLSection;
  costOfSales: PLSection;
  grossProfit: string;
  expenses: PLSection;
  netIncome: string;
}

export interface PLQueryDto {
  fromDate: string;
  toDate: string;
  projectId?: string;
  departmentId?: string;
}

@Injectable()
export class PLReportService {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Generate Profit & Loss report for a date range.
   *
   * Always queries live journal lines (never snapshots) so:
   *   - Entries with entryPurpose = CLOSING are excluded
   *   - Dimension filters (project/department) are applied at line level
   *   - Net income = Revenue - Cost of Sales - Expenses
   */
  async generate(identity: RequestIdentity, dto: PLQueryDto): Promise<PLReportResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);

    const plClasses = ['INCOME', 'COST_OF_SALES', 'EXPENSE'] as const;

    // Load all P&L accounts with their metadata
    const accounts = await prisma.account.findMany({
      where: {
        organizationId: orgId,
        versions: {
          some: { accountClass: { in: plClasses as unknown as never[] } },
        },
      },
      include: { versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    });

    // Build dimension filter for journal lines
    const lineDimFilter: Record<string, string> = {};
    if (dto.projectId) lineDimFilter.projectId = dto.projectId;
    if (dto.departmentId) lineDimFilter.departmentId = dto.departmentId;

    // Aggregate journal line amounts per account (exclude CLOSING entries)
    const agg = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        accountId: { in: accounts.map((a) => a.id) },
        ...(Object.keys(lineDimFilter).length ? lineDimFilter : {}),
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          accountingDate: { gte: from, lte: to },
          entryPurpose: { not: 'CLOSING' },
        },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const amountMap = new Map(
      agg.map((r) => [
        r.accountId,
        {
          debit: new Decimal(r._sum.debitAmount?.toString() ?? '0'),
          credit: new Decimal(r._sum.creditAmount?.toString() ?? '0'),
        },
      ]),
    );

    const revenueLines: PLLine[] = [];
    const cosLines: PLLine[] = [];
    const expenseLines: PLLine[] = [];

    let totalRevenue = new Decimal(0);
    let totalCos = new Decimal(0);
    let totalExpenses = new Decimal(0);

    for (const account of accounts) {
      const version = account.versions[0];
      if (!version) continue;

      const sums = amountMap.get(account.id);
      if (!sums) continue;

      const cls = version.accountClass;

      let amount: Decimal;

      if (cls === 'INCOME') {
        // Revenue: credit-normal → amount = credit - debit (positive = income)
        amount = sums.credit.minus(sums.debit);
        if (amount.isZero()) continue;
        totalRevenue = totalRevenue.plus(amount);
        revenueLines.push(this.makeLine(account, version, amount));
      } else if (cls === 'COST_OF_SALES') {
        // CoS: debit-normal → amount = debit - credit (positive = cost)
        amount = sums.debit.minus(sums.credit);
        if (amount.isZero()) continue;
        totalCos = totalCos.plus(amount);
        cosLines.push(this.makeLine(account, version, amount));
      } else if (cls === 'EXPENSE') {
        // Expense: debit-normal → amount = debit - credit (positive = expense)
        amount = sums.debit.minus(sums.credit);
        if (amount.isZero()) continue;
        totalExpenses = totalExpenses.plus(amount);
        expenseLines.push(this.makeLine(account, version, amount));
      }
    }

    const grossProfit = totalRevenue.minus(totalCos);
    const netIncome = grossProfit.minus(totalExpenses);

    return {
      fromDate: dto.fromDate,
      toDate: dto.toDate,
      organizationId: orgId,
      ...(dto.projectId ? { projectId: dto.projectId } : {}),
      ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      generatedAt: new Date().toISOString(),
      revenue: { label: 'Revenue', total: totalRevenue.toFixed(2), lines: revenueLines },
      costOfSales: { label: 'Cost of Sales', total: totalCos.toFixed(2), lines: cosLines },
      grossProfit: grossProfit.toFixed(2),
      expenses: { label: 'Operating Expenses', total: totalExpenses.toFixed(2), lines: expenseLines },
      netIncome: netIncome.toFixed(2),
    };
  }

  /**
   * Monthly comparison: one P&L column per month in the fiscal year.
   */
  async generateMonthlyComparison(
    identity: RequestIdentity,
    fiscalYearId: string,
    dto: { projectId?: string; departmentId?: string },
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const fy = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, organizationId: orgId },
      include: { periods: { orderBy: { periodNumber: 'asc' } } },
    });

    if (!fy) return null;

    const columns = await Promise.all(
      fy.periods.map(async (period) => {
        const report = await this.generate(identity, {
          fromDate: period.startDate.toISOString().slice(0, 10),
          toDate: period.endDate.toISOString().slice(0, 10),
          ...dto,
        });
        return {
          periodNumber: period.periodNumber,
          periodName: period.name,
          netIncome: report.netIncome,
          revenue: report.revenue.total,
          costOfSales: report.costOfSales.total,
          grossProfit: report.grossProfit,
          expenses: report.expenses.total,
        };
      }),
    );

    return { fiscalYearId, fiscalYearName: fy.name, columns };
  }

  private makeLine(
    account: { id: string; code: string },
    version: { name: string; accountClass: string; accountSubtype: string },
    amount: Decimal,
  ): PLLine {
    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: version.name,
      accountClass: version.accountClass,
      accountSubtype: version.accountSubtype,
      amount: amount.toFixed(2),
    };
  }
}
