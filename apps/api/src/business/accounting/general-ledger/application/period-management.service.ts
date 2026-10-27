import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { SnapshotService } from './snapshot.service.js';

export interface PeriodTransitionResult {
  periodId: string;
  previousStatus: string;
  newStatus: string;
}

export interface ReopenPeriodDto {
  periodId: string;
  reason: string;
}

export interface CloseGateResult {
  passed: boolean;
  blockers: string[];
}

@Injectable()
export class PeriodManagementService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly snapshotService: SnapshotService,
  ) {}

  /**
   * OPEN → LOCKED
   * Gate: no DRAFT or SUBMITTED manual journal entries in the period.
   */
  async lockPeriod(
    identity: RequestIdentity,
    periodId: string,
  ): Promise<PeriodTransitionResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, organizationId: orgId },
    });
    if (!period) throw new NotFoundException(`Period ${periodId} not found`);

    if (period.status !== 'OPEN' && period.status !== 'REOPENED') {
      throw new BadRequestException(
        `Period must be OPEN or REOPENED to lock (current: ${period.status})`,
      );
    }

    const gate = await this.checkLockGate(prisma, orgId, period);
    if (!gate.passed) {
      throw new BadRequestException(
        `Period cannot be locked: ${gate.blockers.join('; ')}`,
      );
    }

    await prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'LOCKED' },
    });

    return { periodId, previousStatus: period.status, newStatus: 'LOCKED' };
  }

  /**
   * LOCKED → CLOSED
   * Gate: all journals POSTED/REVERSED, control account reconciliation passes.
   * Generates the PeriodAccountBalance snapshot atomically.
   */
  async closePeriod(
    identity: RequestIdentity,
    periodId: string,
  ): Promise<PeriodTransitionResult & { snapshotAccountsCount: number }> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, organizationId: orgId },
      include: { fiscalYear: true },
    });
    if (!period) throw new NotFoundException(`Period ${periodId} not found`);

    if (period.status !== 'LOCKED') {
      throw new BadRequestException(
        `Period must be LOCKED before closing (current: ${period.status})`,
      );
    }

    // Close atomically under a row lock on the period. PeriodValidator.resolve takes the same
    // FOR UPDATE lock on the posting path, so an in-flight post serializes against this close:
    // either it commits first (its journal is visible to the gate + snapshot below) or it blocks
    // until we mark CLOSED and is then rejected — it can never land after the snapshot is frozen.
    // The gate re-check, snapshot, and status flip all run on `tx`, so they commit together (a crash
    // can no longer leave a snapshot written but the period still LOCKED, or vice versa).
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM accounting_periods WHERE id = ${periodId} AND organization_id = ${orgId} FOR UPDATE`;

      const locked = await tx.accountingPeriod.findFirst({
        where: { id: periodId, organizationId: orgId },
        include: { fiscalYear: true },
      });
      if (!locked) throw new NotFoundException(`Period ${periodId} not found`);
      if (locked.status !== 'LOCKED') {
        throw new BadRequestException(
          `Period must be LOCKED before closing (current: ${locked.status})`,
        );
      }

      const gate = await this.checkCloseGate(tx as never, orgId, locked);
      if (!gate.passed) {
        throw new BadRequestException(
          `Period cannot be closed: ${gate.blockers.join('; ')}`,
        );
      }

      const snapshot = await this.snapshotService.generateForPeriod(orgId, periodId, userId, tx as never);

      await tx.accountingPeriod.update({
        where: { id: periodId },
        data: { status: 'CLOSED' },
      });

      return {
        periodId,
        previousStatus: 'LOCKED' as const,
        newStatus: 'CLOSED' as const,
        snapshotAccountsCount: snapshot.accountsSnapshotted,
      };
    }, { timeout: 120_000 });
  }

  /**
   * CLOSED → REOPENED
   * Exceptional CFO action. Invalidates snapshots for all subsequent periods.
   */
  async reopenPeriod(
    identity: RequestIdentity,
    dto: ReopenPeriodDto,
  ): Promise<PeriodTransitionResult & { downstreamInvalidated: number }> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    const period = await prisma.accountingPeriod.findFirst({
      where: { id: dto.periodId, organizationId: orgId },
    });
    if (!period) throw new NotFoundException(`Period ${dto.periodId} not found`);

    if (period.status !== 'CLOSED') {
      throw new BadRequestException(
        `Only CLOSED periods can be reopened (current: ${period.status})`,
      );
    }

    // Downstream invalidation, own-period invalidation, and the status flip commit together — a
    // crash between them previously left later periods marked INVALID with no reopened period to
    // explain it.
    const invalidated = await prisma.$transaction(async (tx) => {
      const count = await this.snapshotService.invalidateDownstream(orgId, dto.periodId, tx as never);

      // Invalidate this period's own snapshots too
      await tx.periodAccountBalance.updateMany({
        where: { organizationId: orgId, accountingPeriodId: dto.periodId },
        data: { status: 'INVALID' },
      });

      await tx.accountingPeriod.update({
        where: { id: dto.periodId },
        data: {
          status: 'REOPENED',
          reopenReason: dto.reason,
          reopenedBy: userId,
          reopenedAt: new Date(),
        },
      });

      return count;
    });

    return {
      periodId: dto.periodId,
      previousStatus: 'CLOSED',
      newStatus: 'REOPENED',
      downstreamInvalidated: invalidated,
    };
  }

  async validateCloseGate(identity: RequestIdentity, periodId: string): Promise<CloseGateResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const period = await prisma.accountingPeriod.findFirst({
      where: { id: periodId, organizationId: orgId },
    });
    if (!period) throw new NotFoundException(`Period ${periodId} not found`);

    if (period.status === 'OPEN' || period.status === 'REOPENED') {
      return this.checkLockGate(prisma, orgId, period);
    }
    return this.checkCloseGate(prisma, orgId, period);
  }

  // ─── Gate checks ──────────────────────────────────────────────────────────────

  private async checkLockGate(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    period: { id: string; startDate: Date; endDate: Date },
  ): Promise<CloseGateResult> {
    const blockers: string[] = [];

    const pendingJournals = await this.countPendingJournals(prisma, orgId, period);
    if (pendingJournals > 0) {
      blockers.push(`${pendingJournals} journal(s) are not yet posted (DRAFT/SUBMITTED/APPROVED)`);
    }

    return { passed: blockers.length === 0, blockers };
  }

  private async checkCloseGate(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    period: { id: string; startDate: Date; endDate: Date; fiscalYearId: string; periodNumber: number },
  ): Promise<CloseGateResult> {
    const blockers: string[] = [];

    // 1. No non-terminal journals
    const pendingJournals = await this.countPendingJournals(prisma, orgId, period);
    if (pendingJournals > 0) {
      blockers.push(`${pendingJournals} journal(s) are not yet posted`);
    }

    // 2. AR control reconciliation: AR GL must equal sum of open invoice outstanding amounts
    const arCheck = await this.checkArReconciliation(prisma, orgId);
    if (!arCheck.passed) blockers.push(arCheck.message);

    // 3. AP control reconciliation
    const apCheck = await this.checkApReconciliation(prisma, orgId);
    if (!apCheck.passed) blockers.push(apCheck.message);

    return { passed: blockers.length === 0, blockers };
  }

  /**
   * M1 — journals not yet posted that fall in the period. A draft has no `accountingPeriodId` until
   * it posts, so it is matched on its accounting date as well; counting by period id alone let every
   * draft escape the gate.
   */
  private countPendingJournals(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    period: { id: string; startDate: Date; endDate: Date },
  ): Promise<number> {
    return prisma.journalEntry.count({
      where: {
        organizationId: orgId,
        status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
        OR: [
          { accountingPeriodId: period.id },
          { accountingPeriodId: null, accountingDate: { gte: period.startDate, lte: period.endDate } },
        ],
      },
    });
  }

  /**
   * M1 — the posted GL balance of every account that is an AR/AP control account in any version,
   * each account once (an account with several versions used to be summed once per version).
   *
   * The tie-out compares like with like: the whole posted GL against today's subledger outstanding.
   * Comparing the GL as of period end with today's outstanding failed whenever anything posted after
   * the period end. Rebuilding the subledger as of a past date would need per-date allocation and
   * credit-note history; the control-account invariant (GL = subledger) holds at every moment, so
   * checking it now is what proves the books tie when the period closes.
   */
  private async controlAccountGlBalance(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    subledger: 'ACCOUNTS_RECEIVABLE' | 'ACCOUNTS_PAYABLE',
  ): Promise<Decimal | null> {
    const versions = await prisma.accountVersion.findMany({
      where: { account: { organizationId: orgId }, controlledSubledgerType: subledger, isControlAccount: true },
      select: { accountId: true },
    });
    const accountIds = [...new Set(versions.map((v) => v.accountId))];
    if (accountIds.length === 0) return null;
    const agg = await prisma.journalLine.aggregate({
      where: { accountId: { in: accountIds }, entry: { organizationId: orgId, status: 'POSTED' } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    const debit = new Decimal(agg._sum.debitAmount?.toString() ?? '0');
    const credit = new Decimal(agg._sum.creditAmount?.toString() ?? '0');
    return subledger === 'ACCOUNTS_RECEIVABLE' ? debit.minus(credit) : credit.minus(debit);
  }

  private async checkArReconciliation(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
  ): Promise<{ passed: boolean; message: string }> {
    const glBalance = await this.controlAccountGlBalance(prisma, orgId, 'ACCOUNTS_RECEIVABLE');
    if (glBalance === null) return { passed: true, message: '' };

    const subledgerAgg = await prisma.clientInvoice.aggregate({
      where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
      _sum: { outstandingAmount: true },
    });
    const subledgerBalance = new Decimal(subledgerAgg._sum.outstandingAmount?.toString() ?? '0');

    const variance = glBalance.minus(subledgerBalance).abs();
    if (variance.gt('0.01')) {
      return {
        passed: false,
        message: `AR control reconciliation failed: GL ${glBalance.toFixed(2)} vs subledger ${subledgerBalance.toFixed(2)} (variance ${variance.toFixed(2)})`,
      };
    }

    return { passed: true, message: '' };
  }

  private async checkApReconciliation(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
  ): Promise<{ passed: boolean; message: string }> {
    const glBalance = await this.controlAccountGlBalance(prisma, orgId, 'ACCOUNTS_PAYABLE');
    if (glBalance === null) return { passed: true, message: '' };

    const subledgerAgg = await prisma.supplierBill.aggregate({
      where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
      _sum: { outstandingAmount: true },
    });
    const subledgerBalance = new Decimal(subledgerAgg._sum.outstandingAmount?.toString() ?? '0');

    const variance = glBalance.minus(subledgerBalance).abs();
    if (variance.gt('0.01')) {
      return {
        passed: false,
        message: `AP control reconciliation failed: GL ${glBalance.toFixed(2)} vs subledger ${subledgerBalance.toFixed(2)} (variance ${variance.toFixed(2)})`,
      };
    }

    return { passed: true, message: '' };
  }
}
