import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SnapshotService } from './snapshot.service.js';
import { PLReportService } from './pl-report.service.js';

export interface BSLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountSubtype: string;
  balance: string;
  comparativeBalance?: string;
}

export interface BSSection {
  label: string;
  total: string;
  comparativeTotal?: string;
  lines: BSLine[];
}

export interface BalanceSheetResult {
  asOfDate: string;
  comparativeDate?: string;
  organizationId: string;
  generatedAt: string;
  assets: BSSection;
  liabilities: BSSection;
  equity: BSSection;
  totalLiabilitiesAndEquity: string;
  balanced: boolean;
  comparativeTotalLiabilitiesAndEquity?: string;
  comparativeBalanced?: boolean;
}

export interface BalanceSheetQueryDto {
  asOfDate: string;
  comparativeDate?: string;
}

@Injectable()
export class BalanceSheetService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly snapshotService: SnapshotService,
    private readonly plReportService: PLReportService,
  ) {}

  /**
   * Generate Balance Sheet as of a date.
   *
   * For CLOSED periods: uses PeriodAccountBalance snapshots (closingDebit/Credit).
   * For OPEN/LOCKED/REOPENED: queries live journal lines.
   *
   * Current-period earnings: For an open fiscal year, the EQUITY section includes
   * a computed "Current Year Earnings" line = net P&L from FY start to asOfDate,
   * using live query. This line disappears after year-end close (P&L is rolled into RE).
   *
   * Assets = Liabilities + Equity (must balance within $0.01).
   */
  async generate(
    identity: RequestIdentity,
    dto: BalanceSheetQueryDto,
  ): Promise<BalanceSheetResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const asOf = new Date(dto.asOfDate);

    const current = await this.computeForDate(identity, prisma, orgId, asOf);
    let comparative: Awaited<ReturnType<typeof this.computeForDate>> | null = null;

    if (dto.comparativeDate) {
      comparative = await this.computeForDate(
        identity,
        prisma,
        orgId,
        new Date(dto.comparativeDate),
      );
    }

    const totalAssets = current.totalAssets;
    const totalLiabEquity = current.totalLiabilities.plus(current.totalEquity);
    const balanced = totalAssets.minus(totalLiabEquity).abs().lte('0.01');

    const result: BalanceSheetResult = {
      asOfDate: dto.asOfDate,
      ...(dto.comparativeDate ? { comparativeDate: dto.comparativeDate } : {}),
      organizationId: orgId,
      generatedAt: new Date().toISOString(),
      assets: {
        label: 'Assets',
        total: totalAssets.toFixed(2),
        ...(comparative ? { comparativeTotal: comparative.totalAssets.toFixed(2) } : {}),
        lines: current.assetLines.map((l) => ({
          ...l,
          ...(comparative
            ? { comparativeBalance: comparative!.assetLines.find((cl) => cl.accountId === l.accountId)?.balance ?? '0.00' }
            : {}),
        })),
      },
      liabilities: {
        label: 'Liabilities',
        total: current.totalLiabilities.toFixed(2),
        ...(comparative ? { comparativeTotal: comparative.totalLiabilities.toFixed(2) } : {}),
        lines: current.liabilityLines.map((l) => ({
          ...l,
          ...(comparative
            ? { comparativeBalance: comparative!.liabilityLines.find((cl) => cl.accountId === l.accountId)?.balance ?? '0.00' }
            : {}),
        })),
      },
      equity: {
        label: 'Equity',
        total: current.totalEquity.toFixed(2),
        ...(comparative ? { comparativeTotal: comparative.totalEquity.toFixed(2) } : {}),
        lines: current.equityLines.map((l) => ({
          ...l,
          ...(comparative
            ? { comparativeBalance: comparative!.equityLines.find((cl) => cl.accountId === l.accountId)?.balance ?? '0.00' }
            : {}),
        })),
      },
      totalLiabilitiesAndEquity: totalLiabEquity.toFixed(2),
      balanced,
    };

    if (comparative) {
      const compTotalLiabEquity = comparative.totalLiabilities.plus(comparative.totalEquity);
      result.comparativeTotalLiabilitiesAndEquity = compTotalLiabEquity.toFixed(2);
      result.comparativeBalanced = comparative.totalAssets.minus(compTotalLiabEquity).abs().lte('0.01');
    }

    return result;
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async computeForDate(
    identity: RequestIdentity,
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    asOf: Date,
  ) {
    // Find the period covering this date
    const period = await prisma.accountingPeriod.findFirst({
      where: { organizationId: orgId, startDate: { lte: asOf }, endDate: { gte: asOf } },
      include: { fiscalYear: true },
    });

    const useFrozenSnapshot = period?.status === 'CLOSED' && asOf >= period.endDate;

    let netBalanceMap: Map<string, Decimal>;

    if (useFrozenSnapshot && period) {
      netBalanceMap = await this.netBalancesFromSnapshot(prisma, orgId, period.id);
    } else {
      netBalanceMap = await this.netBalancesFromLive(prisma, orgId, asOf);
    }

    // Load BS accounts (ASSET, LIABILITY, EQUITY)
    const bsClasses = ['ASSET', 'LIABILITY', 'EQUITY'] as const;
    const accounts = await prisma.account.findMany({
      where: {
        organizationId: orgId,
        versions: { some: { accountClass: { in: bsClasses as unknown as never[] } } },
      },
      include: { versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    });

    const assetLines: BSLine[] = [];
    const liabilityLines: BSLine[] = [];
    const equityLines: BSLine[] = [];

    let totalAssets = new Decimal(0);
    let totalLiabilities = new Decimal(0);
    let totalEquity = new Decimal(0);

    for (const account of accounts) {
      const version = account.versions[0];
      if (!version) continue;

      const netBalance = netBalanceMap.get(account.id) ?? new Decimal(0);
      if (netBalance.isZero()) continue;

      const cls = version.accountClass;
      const line: BSLine = {
        accountId: account.id,
        accountCode: account.code,
        accountName: version.name,
        accountSubtype: version.accountSubtype,
        balance: netBalance.abs().toFixed(2),
      };

      if (cls === 'ASSET') {
        // Assets: debit-normal → positive netBalance = asset balance
        totalAssets = totalAssets.plus(netBalance);
        assetLines.push(line);
      } else if (cls === 'LIABILITY') {
        // Liabilities: credit-normal → negative netBalance (debit-credit) = liability balance
        totalLiabilities = totalLiabilities.plus(netBalance.abs());
        liabilityLines.push(line);
      } else if (cls === 'EQUITY') {
        // Equity: credit-normal → negative netBalance = equity balance
        totalEquity = totalEquity.plus(netBalance.abs());
        equityLines.push(line);
      }
    }

    // Current Year Earnings: for open FY periods, add computed net income
    if (period && period.fiscalYear.status !== 'CLOSED') {
      const fyStart = period.fiscalYear.startDate;
      const pl = await this.plReportService.generate(identity, {
        fromDate: fyStart.toISOString().slice(0, 10),
        toDate: asOf.toISOString().slice(0, 10),
      });
      const netIncome = new Decimal(pl.netIncome);

      if (!netIncome.isZero()) {
        equityLines.push({
          accountId: 'CURRENT_YEAR_EARNINGS',
          accountCode: 'CYE',
          accountName: 'Current Year Earnings',
          accountSubtype: 'CURRENT_YEAR_EARNINGS',
          balance: netIncome.toFixed(2),
        });
        totalEquity = totalEquity.plus(netIncome);
      }
    }

    return { totalAssets, totalLiabilities, totalEquity, assetLines, liabilityLines, equityLines };
  }

  private async netBalancesFromSnapshot(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    periodId: string,
  ): Promise<Map<string, Decimal>> {
    const snapshots = await prisma.periodAccountBalance.findMany({
      where: { organizationId: orgId, accountingPeriodId: periodId, status: 'VALID' },
    });

    const map = new Map<string, Decimal>();
    for (const snap of snapshots) {
      const d = new Decimal(snap.closingDebit.toString());
      const c = new Decimal(snap.closingCredit.toString());
      map.set(snap.accountId, d.minus(c));
    }
    return map;
  }

  private async netBalancesFromLive(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    asOf: Date,
  ): Promise<Map<string, Decimal>> {
    const rows = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: { organizationId: orgId, status: 'POSTED', accountingDate: { lte: asOf } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const map = new Map<string, Decimal>();
    for (const row of rows) {
      const d = new Decimal(row._sum.debitAmount?.toString() ?? '0');
      const c = new Decimal(row._sum.creditAmount?.toString() ?? '0');
      map.set(row.accountId, d.minus(c));
    }
    return map;
  }
}
