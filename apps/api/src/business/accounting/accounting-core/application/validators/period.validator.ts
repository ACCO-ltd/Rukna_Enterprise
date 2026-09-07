import { BadRequestException } from '@nestjs/common';
import type { AccountingPeriod } from '@prisma/client';
import type { TxClient } from '../ports/accounting-posting.port.js';

export class PeriodValidator {
  static async resolve(
    tx: TxClient,
    organizationId: string,
    accountingDate: Date,
    journalCategory: string,
  ): Promise<AccountingPeriod> {
    const period = await tx.accountingPeriod.findFirst({
      where: {
        organizationId,
        startDate: { lte: accountingDate },
        endDate: { gte: accountingDate },
      },
      orderBy: { startDate: 'desc' },
    });

    if (!period) {
      throw new BadRequestException(
        `No accounting period covers ${accountingDate.toISOString().slice(0, 10)} for this organization`,
      );
    }

    if (period.status === 'CLOSED') {
      throw new BadRequestException(
        `Accounting period "${period.name}" is CLOSED — no further postings allowed`,
      );
    }

    // A LOCKED period is closed to ordinary business but still open to the entries
    // that finish it: December adjustments, and the year-end closing journal itself.
    // YEAR_END_CLOSE belongs here because `YearEndCloseService` *requires* period 12
    // to be LOCKED before it will run — without this the close could never post, and
    // its only test mocks the posting port, so nothing caught it.
    const LOCKED_PERIOD_CATEGORIES = ['CLOSING_ADJUSTMENT', 'YEAR_END_CLOSE'];
    if (period.status === 'LOCKED' && !LOCKED_PERIOD_CATEGORIES.includes(journalCategory)) {
      throw new BadRequestException(
        `Period "${period.name}" is LOCKED — only ${LOCKED_PERIOD_CATEGORIES.join(' and ')} journals are accepted. ` +
        `Received category: ${journalCategory}`,
      );
    }

    return period;
  }
}
