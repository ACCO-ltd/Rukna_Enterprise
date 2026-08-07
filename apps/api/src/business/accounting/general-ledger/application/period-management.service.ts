import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
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

    const gate = await this.checkCloseGate(prisma, orgId, period);
    if (!gate.passed) {
      throw new BadRequestException(
        `Period cannot be closed: ${gate.blockers.join('; ')}`,
      );
    }

    // Generate snapshot BEFORE marking CLOSED
    const snapshot = await this.snapshotService.generateForPeriod(orgId, periodId, userId);

    await prisma.accountingPeriod.update({
      where: { id: periodId },
      data: { status: 'CLOSED' },
    });

    return {
      periodId,
      previousStatus: 'LOCKED',
      newStatus: 'CLOSED',
      snapshotAccountsCount: snapshot.accountsSnapshotted,
    };
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

    const invalidated = await this.snapshotService.invalidateDownstream(orgId, dto.periodId);

    // Invalidate this period's own snapshots too
    await prisma.periodAccountBalance.updateMany({
      where: { organizationId: orgId, accountingPeriodId: dto.periodId },
      data: { status: 'INVALID' },
    });

    await prisma.accountingPeriod.update({
      where: { id: dto.periodId },
      data: {
        status: 'REOPENED',
        reopenReason: dto.reason,
        reopenedBy: userId,
        reopenedAt: new Date(),
      },
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

    const pendingJournals = await prisma.journalEntry.count({
      where: {
        organizationId: orgId,
        accountingPeriodId: period.id,
        status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
      },
    });
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
    const pendingJournals = await prisma.journalEntry.count({
      where: {
        organizationId: orgId,
        accountingPeriodId: period.id,
        status: { in: ['DRAFT', 'SUBMITTED', 'APPROVED'] },
      },
    });
    if (pendingJournals > 0) {
      blockers.push(`${pendingJournals} journal(s) are not yet posted`);
    }

    // 2. AR control reconciliation: AR GL must equal sum of open invoice outstanding amounts
    const arCheck = await this.checkArReconciliation(prisma, orgId, period.endDate);
    if (!arCheck.passed) blockers.push(arCheck.message);

    // 3. AP control reconciliation
    const apCheck = await this.checkApReconciliation(prisma, orgId, period.endDate);
    if (!apCheck.passed) blockers.push(apCheck.message);

    return { passed: blockers.length === 0, blockers };
  }

  private async checkArReconciliation(
    prisma: Omit<import('@prisma/client').PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
    orgId: string,
    asOf: Date,
  ): Promise<{ passed: boolean; message: string }> {
    // Find AR control accounts
    const arAccounts = await prisma.accountVersion.findMany({
      where: {
        account: { organizationId: orgId },
        controlledSubledgerType: 'ACCOUNTS_RECEIVABLE',
        isControlAccount: true,
      },
      select: { accountId: true },
    });

    if (arAccounts.length === 0) return { passed: true, message: '' };

    let glBalance = new (await import('@prisma/client/runtime/library')).Decimal(0);
    for (const { accountId } of arAccounts) {
      const agg = await prisma.journalLine.aggregate({
        where: {
          accountId,
          entry: { organizationId: orgId, status: 'POSTED', accountingDate: { lte: asOf } },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });
      const d = new (await import('@prisma/client/runtime/library')).Decimal(agg._sum.debitAmount?.toString() ?? '0');
      const c = new (await import('@prisma/client/runtime/library')).Decimal(agg._sum.creditAmount?.toString() ?? '0');
      glBalance = glBalance.plus(d.minus(c));
    }

    const subledgerAgg = await prisma.clientInvoice.aggregate({
      where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
      _sum: { outstandingAmount: true },
    });
    const subledgerBalance = new (await import('@prisma/client/runtime/library')).Decimal(
      subledgerAgg._sum.outstandingAmount?.toString() ?? '0',
    );

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
    asOf: Date,
  ): Promise<{ passed: boolean; message: string }> {
    const apAccounts = await prisma.accountVersion.findMany({
      where: {
        account: { organizationId: orgId },
        controlledSubledgerType: 'ACCOUNTS_PAYABLE',
        isControlAccount: true,
      },
      select: { accountId: true },
    });

    if (apAccounts.length === 0) return { passed: true, message: '' };

    const { Decimal: D } = await import('@prisma/client/runtime/library');
    let glBalance = new D(0);
    for (const { accountId } of apAccounts) {
      const agg = await prisma.journalLine.aggregate({
        where: {
          accountId,
          entry: { organizationId: orgId, status: 'POSTED', accountingDate: { lte: asOf } },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });
      const d = new D(agg._sum.debitAmount?.toString() ?? '0');
      const c = new D(agg._sum.creditAmount?.toString() ?? '0');
      glBalance = glBalance.plus(c.minus(d)); // AP is credit-normal
    }

    const subledgerAgg = await prisma.supplierBill.aggregate({
      where: { organizationId: orgId, postingStatus: { in: ['POSTED', 'OPENING_BALANCE'] } },
      _sum: { outstandingAmount: true },
    });
    const subledgerBalance = new D(subledgerAgg._sum.outstandingAmount?.toString() ?? '0');

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
