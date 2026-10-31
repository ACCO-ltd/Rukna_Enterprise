import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SnapshotService } from './snapshot.service.js';
import { PLReportService } from './pl-report.service.js';
import { parseDateOnly } from '../../accounting-core/domain/calendar-day.js';

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

/**
 * Lines for both dates: every account with a balance on either, in code order. An account that
 * held money on the comparison date and nothing now still shows, or the comparison column would
 * not add up to its own total.
 */
function mergeLines(current: BSLine[], comparative?: BSLine[]): BSLine[] {
  if (!comparative) return current;
  const byId = new Map<string, BSLine>();
  for (const l of current) byId.set(l.accountId, { ...l, comparativeBalance: '0.00' });
  for (const l of comparative) {
    const existing = byId.get(l.accountId);
    if (existing) existing.comparativeBalance = l.balance;
    else byId.set(l.accountId, { ...l, balance: '0.00', comparativeBalance: l.balance });
  }
  return [...byId.values()];
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
   * Earnings not yet closed: the EQUITY section adds "Net income this year" (P&L from the fiscal
   * year's start to asOfDate) and, when an earlier year was never closed, "Earlier years not yet
   * closed". Both disappear once year-end close rolls P&L into retained earnings.
   *
   * Assets = Liabilities + Equity (must balance within $0.01).
   */
  async generate(
    identity: RequestIdentity,
    dto: BalanceSheetQueryDto,
  ): Promise<BalanceSheetResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const asOf = dto.asOfDate?.length >= 10 ? parseDateOnly(dto.asOfDate) : null;
    const comparativeAsOf = dto.comparativeDate ? (dto.comparativeDate.length >= 10 ? parseDateOnly(dto.comparativeDate) : null) : undefined;
    if (!asOf || comparativeAsOf === null) {
      throw new BadRequestException({ errorCode: 'DATE_INVALID', message: 'The date must be a real date written YYYY-MM-DD.' });
    }

    const current = await this.computeForDate(identity, prisma, orgId, asOf);
    let comparative: Awaited<ReturnType<typeof this.computeForDate>> | null = null;

    if (dto.comparativeDate) {
      comparative = await this.computeForDate(
        identity,
        prisma,
        orgId,
        comparativeAsOf!,
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
        lines: mergeLines(current.assetLines, comparative?.assetLines),
      },
      liabilities: {
        label: 'Liabilities',
        total: current.totalLiabilities.toFixed(2),
        ...(comparative ? { comparativeTotal: comparative.totalLiabilities.toFixed(2) } : {}),
        lines: mergeLines(current.liabilityLines, comparative?.liabilityLines),
      },
      equity: {
        label: 'Equity',
        total: current.totalEquity.toFixed(2),
        ...(comparative ? { comparativeTotal: comparative.totalEquity.toFixed(2) } : {}),
        lines: mergeLines(current.equityLines, comparative?.equityLines),
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
      // Each line shows its balance on the account's normal side, keeping the sign: assets are
      // debit-normal (debit − credit), liabilities and equity credit-normal (credit − debit). An
      // abs() here turned a contra balance — owner drawings, a liability in debit — into an
      // addition, so the totals overstated and `balanced` could flag a correct ledger.
      const normalBalance = cls === 'ASSET' ? netBalance : netBalance.negated();
      const line: BSLine = {
        accountId: account.id,
        accountCode: account.code,
        accountName: version.name,
        accountSubtype: version.accountSubtype,
        balance: normalBalance.toFixed(2),
      };

      if (cls === 'ASSET') {
        totalAssets = totalAssets.plus(normalBalance);
        assetLines.push(line);
      } else if (cls === 'LIABILITY') {
        totalLiabilities = totalLiabilities.plus(normalBalance);
        liabilityLines.push(line);
      } else if (cls === 'EQUITY') {
        totalEquity = totalEquity.plus(normalBalance);
        equityLines.push(line);
      }
    }

    // R-BS — earnings not yet closed into retained earnings. Every income, cost and expense balance
    // up to the date is profit the books still hold on P&L accounts (a year-end close moves it to
    // retained earnings, leaving them at zero). This year's share is the P&L from the fiscal year's
    // start; anything left is an earlier year nobody has closed. Reading it from the balances, not
    // from the period, keeps the sheet balanced on a date outside every period and when a prior
    // year is still open.
    const plIds = await prisma.account.findMany({
      where: { organizationId: orgId, versions: { some: { effectiveTo: null, accountClass: { in: ['INCOME', 'COST_OF_SALES', 'EXPENSE'] } } } },
      select: { id: true },
    });
    const unclosed = plIds.reduce((sum, a) => sum.plus(netBalanceMap.get(a.id) ?? 0), new Decimal(0)).negated();
    const year = await prisma.fiscalYear.findFirst({
      where: { organizationId: orgId, startDate: { lte: asOf }, endDate: { gte: asOf } },
    });
    let thisYear = new Decimal(0);
    if (year && year.status !== 'CLOSED') {
      const pl = await this.plReportService.generate(identity, {
        fromDate: year.startDate.toISOString().slice(0, 10),
        toDate: asOf.toISOString().slice(0, 10),
      });
      thisYear = new Decimal(pl.netIncome);
    }
    const earlier = unclosed.minus(thisYear);
    if (!earlier.isZero()) {
      equityLines.push({
        accountId: 'PRIOR_YEAR_EARNINGS',
        accountCode: 'RE',
        accountName: 'Earlier years not yet closed',
        accountSubtype: 'RETAINED_EARNINGS',
        balance: earlier.toFixed(2),
      });
      totalEquity = totalEquity.plus(earlier);
    }
    if (!thisYear.isZero()) {
      equityLines.push({
        accountId: 'CURRENT_YEAR_EARNINGS',
        accountCode: 'CYE',
        accountName: 'Net income this year',
        accountSubtype: 'CURRENT_YEAR_EARNINGS',
        balance: thisYear.toFixed(2),
      });
      totalEquity = totalEquity.plus(thisYear);
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
