import { BadRequestException } from '@nestjs/common';
import type { AccountingPeriod } from '@prisma/client';
import type { TxClient } from '../ports/accounting-posting.port.js';
import { periodPostingBlock, periodPostingBlockMessage } from '../../domain/period-posting.policy.js';

export class PeriodValidator {
  /**
   * The period covering `accountingDate` — the same lookup `resolve` posts against. Unlocked: the
   * "why blocked" read models (ADR-043) use it to predict the posting gate without taking a lock.
   */
  static findCovering(
    client: Pick<TxClient, 'accountingPeriod'>,
    organizationId: string,
    accountingDate: Date,
  ): Promise<AccountingPeriod | null> {
    return client.accountingPeriod.findFirst({
      where: {
        organizationId,
        startDate: { lte: accountingDate },
        endDate: { gte: accountingDate },
      },
      orderBy: { startDate: 'desc' },
    });
  }

  static async resolve(
    tx: TxClient,
    organizationId: string,
    accountingDate: Date,
    journalCategory: string,
  ): Promise<AccountingPeriod> {
    const period = await PeriodValidator.findCovering(tx, organizationId, accountingDate);

    if (!period) {
      throw new BadRequestException(
        periodPostingBlockMessage('NO_PERIOD', { accountingDate, journalCategory }),
      );
    }

    // Lock the period row FOR UPDATE and read its status under the lock. PeriodManagementService.
    // closePeriod locks the same row before it snapshots and flips to CLOSED, so this posting
    // serializes against a concurrent close: if the close commits first we see CLOSED here and
    // reject; if we commit first, the close's gate and snapshot include this journal. Without the
    // lock, a stale status read (READ COMMITTED) lets a journal land in a period after it was closed
    // and its balances were frozen.
    const lockedRows = await tx.$queryRaw<Array<{ status: string }>>`
      SELECT status FROM accounting_periods WHERE id = ${period.id} FOR UPDATE
    `;
    const status = (lockedRows[0]?.status ?? period.status) as AccountingPeriod['status'];

    // CLOSED refuses everything; LOCKED accepts only the entries that finish the period
    // (`periodPostingBlock` — the same rule the "why blocked" read models use, ADR-043).
    const block = periodPostingBlock({ name: period.name, status }, journalCategory);
    if (block) {
      throw new BadRequestException(
        periodPostingBlockMessage(block, { accountingDate, periodName: period.name, journalCategory }),
      );
    }

    return { ...period, status };
  }
}
