import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { PrismaClient, JournalEntry } from '@prisma/client';
import type { TxClient } from '../application/ports/accounting-posting.port.js';

type TenantPrisma = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

export type JournalWithLines = JournalEntry & {
  lines: {
    id: string; lineNumber: number; accountId: string; accountCodeSnapshot: string;
    accountNameSnapshot: string; debitAmount: unknown; creditAmount: unknown;
  }[];
};

@Injectable()
export class JournalRepository {
  findById(prisma: TenantPrisma, organizationId: string, id: string): Promise<JournalWithLines | null> {
    return prisma.journalEntry.findFirst({
      where: { id, organizationId },
      include: { lines: { orderBy: { lineNumber: 'asc' } } },
    }) as Promise<JournalWithLines | null>;
  }

  findBySourceDocument(
    tx: TxClient,
    organizationId: string,
    sourceDocumentType: string,
    sourceDocumentId: string,
    eventType: string,
  ): Promise<JournalEntry | null> {
    return tx.journalEntry.findUnique({
      where: {
        organizationId_sourceDocumentType_sourceDocumentId_accountingEventId: {
          organizationId,
          sourceDocumentType: sourceDocumentType as never,
          sourceDocumentId,
          accountingEventId: eventType,
        },
      },
    });
  }

  findPendingByOrg(prisma: TenantPrisma, organizationId: string) {
    return prisma.journalEntry.findMany({
      where: { organizationId, status: 'DRAFT' },
      orderBy: { createdAt: 'asc' },
    });
  }

  findByPeriod(prisma: TenantPrisma, organizationId: string, periodId: string) {
    return prisma.journalEntry.findMany({
      where: { organizationId, accountingPeriodId: periodId },
      include: { lines: true },
      orderBy: { journalNumber: 'asc' },
    });
  }

  /**
   * Net GL balance for an account across all POSTED journals.
   * Returns (∑debitAmount - ∑creditAmount).
   * Positive = net debit balance (assets/expenses); negative = net credit balance (liabilities/equity).
   */
  async getGlBalance(tx: TenantPrisma, organizationId: string, accountId: string): Promise<Decimal> {
    const result = await tx.journalLine.aggregate({
      where: {
        accountId,
        entry: { organizationId, status: 'POSTED' },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const totalDebit = new Decimal(result._sum.debitAmount?.toString() ?? '0');
    const totalCredit = new Decimal(result._sum.creditAmount?.toString() ?? '0');
    return totalDebit.minus(totalCredit);
  }

  /**
   * Resolve the effective AccountVersion for a given account on a given date.
   * Uses half-open interval: effectiveFrom <= date < effectiveTo (or effectiveTo IS NULL).
   */
  async resolveAccountVersion(
    tx: TxClient,
    accountId: string,
    accountingDate: Date,
  ) {
    const version = await tx.accountVersion.findFirst({
      where: {
        accountId,
        effectiveFrom: { lte: accountingDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: accountingDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    return version;
  }
}
