import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SnapshotService } from './snapshot.service.js';

export interface TrialBalanceLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  accountClass: string;
  accountSubtype: string;
  openingDebit: string;
  openingCredit: string;
  periodDebit: string;
  periodCredit: string;
  closingDebit: string;
  closingCredit: string;
}

export interface TrialBalanceResult {
  asOfDate: string;
  generatedAt: string;
  organizationId: string;
  totalOpeningDebit: string;
  totalOpeningCredit: string;
  totalPeriodDebit: string;
  totalPeriodCredit: string;
  totalClosingDebit: string;
  totalClosingCredit: string;
  balanced: boolean;
  lines: TrialBalanceLine[];
}

export interface TrialBalanceQueryDto {
  asOfDate: string;
  includeZeroBalance?: boolean;
  periodId?: string;
}

/** A balance on one side: debit when debits exceed credits, else credit. */
function net(debit: Decimal, credit: Decimal): { debit: Decimal; credit: Decimal } {
  const diff = debit.minus(credit);
  return diff.gte(0) ? { debit: diff, credit: new Decimal(0) } : { debit: new Decimal(0), credit: diff.negated() };
}

@Injectable()
export class TrialBalanceService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly snapshotService: SnapshotService,
  ) {}

  /**
   * Generate a trial balance as of a date.
   *
   * For each account: opening = sum of POSTED lines before period start,
   * period movement = sum of POSTED lines within the period (up to asOfDate),
   * closing = opening + movement.
   *
   * For CLOSED periods, uses PeriodAccountBalance snapshots when available.
   */
  async generate(
    identity: RequestIdentity,
    dto: TrialBalanceQueryDto,
  ): Promise<TrialBalanceResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const asOf = new Date(dto.asOfDate);

    // Find the period that contains the asOfDate
    const period = await prisma.accountingPeriod.findFirst({
      where: {
        organizationId: orgId,
        startDate: { lte: asOf },
        endDate: { gte: asOf },
      },
    });

    // Determine effective "to" date: the earlier of asOf or period end
    const effectiveTo = period
      ? new Date(Math.min(asOf.getTime(), period.endDate.getTime()))
      : asOf;

    const periodStart = period?.startDate;

    // If the period is CLOSED and we have a VALID snapshot, use it
    // (but only when the asOf date reaches the full period end)
    const useFrozenSnapshot =
      period?.status === 'CLOSED' &&
      asOf >= period.endDate &&
      !dto.periodId;

    let balanceMap: Map<
      string,
      { openingDebit: Decimal; openingCredit: Decimal; periodDebit: Decimal; periodCredit: Decimal }
    >;

    if (useFrozenSnapshot) {
      balanceMap = await this.fromSnapshot(prisma, orgId, period!.id);
    } else {
      balanceMap = await this.fromLive(prisma, orgId, periodStart, effectiveTo);
    }

    // Load account metadata for all accounts in map
    const accountIds = [...balanceMap.keys()];
    if (accountIds.length === 0) {
      return this.emptyResult(dto.asOfDate, orgId);
    }

    const accounts = await prisma.account.findMany({
      where: { id: { in: accountIds }, organizationId: orgId },
      include: { versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
      orderBy: { code: 'asc' },
    });

    const lines: TrialBalanceLine[] = [];
    let totalOpeningDebit = new Decimal(0);
    let totalOpeningCredit = new Decimal(0);
    let totalPeriodDebit = new Decimal(0);
    let totalPeriodCredit = new Decimal(0);
    let totalClosingDebit = new Decimal(0);
    let totalClosingCredit = new Decimal(0);

    for (const account of accounts) {
      const bal = balanceMap.get(account.id);
      if (!bal) continue;

      // R-1 — opening and closing are balances: netted onto one side, as a trial balance reads.
      // (They were the gross debits and credits ever posted, so a bank account with 1,700 in and
      // 1,158 out read 1,700 Dr and 1,158 Cr instead of 542 Dr, and the totals were inflated.)
      // The period columns stay gross: they are the movement.
      const opening = net(bal.openingDebit, bal.openingCredit);
      const closing = net(bal.openingDebit.plus(bal.periodDebit), bal.openingCredit.plus(bal.periodCredit));
      const closingDebit = closing.debit;
      const closingCredit = closing.credit;

      // Hidden unless asked: an account with nothing left on it and no movement in the period.
      if (!dto.includeZeroBalance && closingDebit.isZero() && closingCredit.isZero() && bal.periodDebit.isZero() && bal.periodCredit.isZero()) continue;

      const version = account.versions[0];

      lines.push({
        accountId: account.id,
        accountCode: account.code,
        accountName: version?.name ?? account.code,
        accountClass: version?.accountClass ?? '',
        accountSubtype: version?.accountSubtype ?? '',
        openingDebit: opening.debit.toFixed(2),
        openingCredit: opening.credit.toFixed(2),
        periodDebit: bal.periodDebit.toFixed(2),
        periodCredit: bal.periodCredit.toFixed(2),
        closingDebit: closingDebit.toFixed(2),
        closingCredit: closingCredit.toFixed(2),
      });

      totalOpeningDebit = totalOpeningDebit.plus(opening.debit);
      totalOpeningCredit = totalOpeningCredit.plus(opening.credit);
      totalPeriodDebit = totalPeriodDebit.plus(bal.periodDebit);
      totalPeriodCredit = totalPeriodCredit.plus(bal.periodCredit);
      totalClosingDebit = totalClosingDebit.plus(closingDebit);
      totalClosingCredit = totalClosingCredit.plus(closingCredit);
    }

    const balanced = totalClosingDebit.minus(totalClosingCredit).abs().lte('0.01');

    return {
      asOfDate: dto.asOfDate,
      generatedAt: new Date().toISOString(),
      organizationId: orgId,
      totalOpeningDebit: totalOpeningDebit.toFixed(2),
      totalOpeningCredit: totalOpeningCredit.toFixed(2),
      totalPeriodDebit: totalPeriodDebit.toFixed(2),
      totalPeriodCredit: totalPeriodCredit.toFixed(2),
      totalClosingDebit: totalClosingDebit.toFixed(2),
      totalClosingCredit: totalClosingCredit.toFixed(2),
      balanced,
      lines,
    };
  }

  // ─── Private ──────────────────────────────────────────────────────────────────

  private async fromSnapshot(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    periodId: string,
  ) {
    const snapshots = await prisma.periodAccountBalance.findMany({
      where: { organizationId: orgId, accountingPeriodId: periodId, status: 'VALID' },
    });

    const map = new Map<string, { openingDebit: Decimal; openingCredit: Decimal; periodDebit: Decimal; periodCredit: Decimal }>();
    for (const snap of snapshots) {
      map.set(snap.accountId, {
        openingDebit: new Decimal(snap.openingDebit.toString()),
        openingCredit: new Decimal(snap.openingCredit.toString()),
        periodDebit: new Decimal(snap.periodDebit.toString()),
        periodCredit: new Decimal(snap.periodCredit.toString()),
      });
    }
    return map;
  }

  private async fromLive(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    periodStart: Date | undefined,
    effectiveTo: Date,
  ) {
    const map = new Map<string, { openingDebit: Decimal; openingCredit: Decimal; periodDebit: Decimal; periodCredit: Decimal }>();

    // Get opening (before periodStart) per account
    if (periodStart) {
      const openingLines = await prisma.journalLine.groupBy({
        by: ['accountId'],
        where: {
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            accountingDate: { lt: periodStart },
          },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });

      for (const row of openingLines) {
        map.set(row.accountId, {
          openingDebit: new Decimal(row._sum.debitAmount?.toString() ?? '0'),
          openingCredit: new Decimal(row._sum.creditAmount?.toString() ?? '0'),
          periodDebit: new Decimal(0),
          periodCredit: new Decimal(0),
        });
      }
    }

    // Period movement
    const movementWhere = periodStart
      ? { gte: periodStart, lte: effectiveTo }
      : { lte: effectiveTo };

    const periodLines = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          accountingDate: movementWhere,
        },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    for (const row of periodLines) {
      const existing = map.get(row.accountId) ?? {
        openingDebit: new Decimal(0),
        openingCredit: new Decimal(0),
        periodDebit: new Decimal(0),
        periodCredit: new Decimal(0),
      };
      existing.periodDebit = new Decimal(row._sum.debitAmount?.toString() ?? '0');
      existing.periodCredit = new Decimal(row._sum.creditAmount?.toString() ?? '0');
      map.set(row.accountId, existing);
    }

    return map;
  }

  private emptyResult(asOfDate: string, orgId: string): TrialBalanceResult {
    const zero = '0.00';
    return {
      asOfDate, generatedAt: new Date().toISOString(), organizationId: orgId,
      totalOpeningDebit: zero, totalOpeningCredit: zero,
      totalPeriodDebit: zero, totalPeriodCredit: zero,
      totalClosingDebit: zero, totalClosingCredit: zero,
      balanced: true, lines: [],
    };
  }
}
