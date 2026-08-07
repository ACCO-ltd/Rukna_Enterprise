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

    if (period.status === 'LOCKED' && journalCategory !== 'CLOSING_ADJUSTMENT') {
      throw new BadRequestException(
        `Period "${period.name}" is LOCKED — only CLOSING_ADJUSTMENT journals are accepted. ` +
        `Received category: ${journalCategory}`,
      );
    }

    return period;
  }
}
