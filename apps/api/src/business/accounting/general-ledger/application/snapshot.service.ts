import { Injectable, BadRequestException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaClient, AccountingPeriod } from '@prisma/client';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export interface SnapshotSummary {
  accountingPeriodId: string;
  accountsSnapshotted: number;
  generatedAt: Date;
}

@Injectable()
export class SnapshotService {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Generate PeriodAccountBalance snapshots for every account that had
   * any journal activity in or before this period.
   *
   * Opening: chains from previous period's closingDebit/closingCredit if a
   * VALID snapshot exists; otherwise queries live journal lines.
   *
   * Period movement: ALL POSTED journal lines whose accountingDate falls
   * within [period.startDate, period.endDate] (including CLOSING entries —
   * the closing entry is what zeroes P&L to RE, so it must be in the snapshot
   * for the Balance Sheet to balance).
   */
  async generateForPeriod(
    orgId: string,
    periodId: string,
    generatedBy: string,
    /**
     * Join a caller's transaction. Year-end close posts the closing journal and
     * snapshots the period it belongs to; both have to commit together, or a crash
     * between them leaves a posted closing entry with no snapshot behind it.
     */
    client?: TenantPrisma,
  ): Promise<SnapshotSummary> {
    const prisma = client ?? this.tenancyService.getClient();

    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, organizationId: orgId },
      include: { fiscalYear: true },
    });
    if (!period) throw new BadRequestException(`Period ${periodId} not found`);

    const prevPeriodSnapshots = await this.getPreviousPeriodSnapshot(prisma, orgId, period);

    // Find all accounts with any POSTED journal lines up to and including this period
    const activeAccountIds = await this.findActiveAccounts(prisma, orgId, period.endDate);

    if (activeAccountIds.length === 0) {
      return { accountingPeriodId: periodId, accountsSnapshotted: 0, generatedAt: new Date() };
    }

    // Delete existing snapshots for this period (re-generation)
    await prisma.periodAccountBalance.deleteMany({
      where: { organizationId: orgId, accountingPeriodId: periodId },
    });

    const now = new Date();
    const snapshotRows = await Promise.all(
      activeAccountIds.map(async (accountId) => {
        const prev = prevPeriodSnapshots.get(accountId);

        let openingDebit: Decimal;
        let openingCredit: Decimal;

        if (prev) {
          openingDebit = new Decimal(prev.closingDebit.toString());
          openingCredit = new Decimal(prev.closingCredit.toString());
        } else {
          // Opening = everything strictly BEFORE the period start. Use an exclusive date comparison
          // (accountingDate < startDate) rather than subtracting 1ms from a @db.Date — the ms trick
          // is wall-clock arithmetic that can shift the boundary a day on a non-UTC server.
          const opening = await this.sumJournalLines(
            prisma, orgId, accountId,
            undefined, period.startDate, true,
          );
          openingDebit = opening.debit;
          openingCredit = opening.credit;
        }

        const movement = await this.sumJournalLines(
          prisma, orgId, accountId,
          period.startDate, period.endDate,
        );

        const closingDebit = openingDebit.plus(movement.debit);
        const closingCredit = openingCredit.plus(movement.credit);

        return {
          organizationId: orgId,
          fiscalYearId: period.fiscalYearId,
          accountingPeriodId: periodId,
          accountId,
          openingDebit,
          openingCredit,
          periodDebit: movement.debit,
          periodCredit: movement.credit,
          closingDebit,
          closingCredit,
          snapshotVersion: 1,
          generatedAt: now,
          generatedBy,
          status: 'VALID' as const,
        };
      }),
    );

    await prisma.periodAccountBalance.createMany({ data: snapshotRows as never[] });

    return {
      accountingPeriodId: periodId,
      accountsSnapshotted: snapshotRows.length,
      generatedAt: now,
    };
  }

  /**
   * Mark snapshots for all periods AFTER the given period as INVALID.
   * Called when a period is reopened — the opening chain is broken.
   */
  async invalidateDownstream(
    orgId: string,
    reopenedPeriodId: string,
    client?: TenantPrisma,
  ): Promise<number> {
    const prisma = client ?? this.tenancyService.getClient();

    const period = await prisma.accountingPeriod.findFirst({
      where: { id: reopenedPeriodId, organizationId: orgId },
    });
    if (!period) return 0;

    // Every period that starts AFTER the reopened one — across ALL fiscal years, not just this one.
    // A reopened prior-year period feeds later years' opening balances (year-end retained-earnings
    // roll + period-1 opening chains), so their frozen snapshots are no longer trustworthy either.
    // The old fiscalYear-scoped filter left next year's snapshots VALID and silently stale.
    const laterPeriods = await prisma.accountingPeriod.findMany({
      where: {
        organizationId: orgId,
        startDate: { gt: period.startDate },
      },
      select: { id: true },
    });

    if (laterPeriods.length === 0) return 0;

    const laterIds = laterPeriods.map((p) => p.id);
    const result = await prisma.periodAccountBalance.updateMany({
      where: { organizationId: orgId, accountingPeriodId: { in: laterIds } },
      data: { status: 'INVALID' },
    });

    return result.count;
  }

  /**
   * Rebuild snapshots sequentially from startPeriodId through all later
   * CLOSED periods — chronologically, across fiscal-year boundaries, so a rebuild after a
   * prior-year reopen actually restores the downstream chain in later years too.
   */
  async rebuildFromPeriod(
    orgId: string,
    startPeriodId: string,
    generatedBy: string,
  ): Promise<SnapshotSummary[]> {
    const prisma = this.tenancyService.getClient();

    const startPeriod = await prisma.accountingPeriod.findFirst({
      where: { id: startPeriodId, organizationId: orgId },
    });
    if (!startPeriod) throw new BadRequestException(`Period ${startPeriodId} not found`);

    const periodsToRebuild = await prisma.accountingPeriod.findMany({
      where: {
        organizationId: orgId,
        startDate: { gte: startPeriod.startDate },
        status: { in: ['CLOSED'] },
      },
      orderBy: { startDate: 'asc' },
    });

    const results: SnapshotSummary[] = [];
    for (const period of periodsToRebuild) {
      const summary = await this.generateForPeriod(orgId, period.id, generatedBy);
      results.push(summary);
    }

    return results;
  }

  async getSnapshotForPeriod(prisma: TenantPrisma, orgId: string, periodId: string) {
    return prisma.periodAccountBalance.findMany({
      where: {
        organizationId: orgId,
        accountingPeriodId: periodId,
        status: 'VALID',
      },
    });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────

  private async findActiveAccounts(
    prisma: TenantPrisma,
    orgId: string,
    upToDate: Date,
  ): Promise<string[]> {
    const rows = await prisma.journalLine.findMany({
      where: {
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          accountingDate: { lte: upToDate },
        },
      },
      select: { accountId: true },
      distinct: ['accountId'],
    });
    return rows.map((r) => r.accountId);
  }

  private async sumJournalLines(
    prisma: TenantPrisma,
    orgId: string,
    accountId: string,
    fromDate: Date | undefined,
    toDate: Date,
    toExclusive = false,
  ): Promise<{ debit: Decimal; credit: Decimal }> {
    const where: Record<string, unknown> = {
      accountId,
      entry: {
        organizationId: orgId,
        status: 'POSTED',
        accountingDate: {
          ...(fromDate ? { gte: fromDate } : {}),
          ...(toExclusive ? { lt: toDate } : { lte: toDate }),
        },
      },
    };

    const result = await prisma.journalLine.aggregate({
      where: where as never,
      _sum: { debitAmount: true, creditAmount: true },
    });

    return {
      debit: new Decimal(result._sum.debitAmount?.toString() ?? '0'),
      credit: new Decimal(result._sum.creditAmount?.toString() ?? '0'),
    };
  }

  private async getPreviousPeriodSnapshot(
    prisma: TenantPrisma,
    orgId: string,
    period: AccountingPeriod,
  ): Promise<Map<string, { closingDebit: Decimal; closingCredit: Decimal }>> {
    const map = new Map<string, { closingDebit: Decimal; closingCredit: Decimal }>();

    const prevPeriod = await prisma.accountingPeriod.findFirst({
      where: {
        organizationId: orgId,
        fiscalYearId: period.fiscalYearId,
        periodNumber: period.periodNumber - 1,
      },
    });

    if (!prevPeriod) return map;

    const snapshots = await prisma.periodAccountBalance.findMany({
      where: {
        organizationId: orgId,
        accountingPeriodId: prevPeriod.id,
        status: 'VALID',
      },
    });

    for (const snap of snapshots) {
      map.set(snap.accountId, {
        closingDebit: new Decimal(snap.closingDebit.toString()),
        closingCredit: new Decimal(snap.closingCredit.toString()),
      });
    }

    return map;
  }

}
