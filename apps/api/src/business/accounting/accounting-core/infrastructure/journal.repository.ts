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

  /**
   * GL-J — what a manual journal needs to know about each account it names: active, open to
   * posting on the day (a heading is not), and not one the system keeps for itself.
   */
  async accountFacts(prisma: TenantPrisma, organizationId: string, accountIds: string[], on: Date) {
    const accounts = await prisma.account.findMany({
      where: { organizationId, id: { in: [...new Set(accountIds)] } },
      select: {
        id: true, code: true, status: true,
        versions: {
          where: { effectiveFrom: { lte: on }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: on } }] },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
          select: { name: true, isPostingAllowed: true, isControlAccount: true, controlPostingPolicy: true },
        },
      },
    });
    return new Map(
      accounts.map((a) => {
        const v = a.versions[0];
        return [a.id, {
          code: a.code,
          name: v?.name ?? a.code,
          active: a.status === 'ACTIVE',
          postingAllowed: v?.isPostingAllowed ?? false,
          control: v?.isControlAccount ?? false,
          systemOnly: v?.controlPostingPolicy === 'SYSTEM_ONLY',
        }] as const;
      }),
    );
  }

  /** The journals around one entry: what reversed it, what it reverses, and the draft it posted from. */
  async related(prisma: TenantPrisma, organizationId: string, journal: { id: string; reversalOfJournalEntryId: string | null }) {
    const [reversals, reversalOf, draft] = await Promise.all([
      prisma.journalEntry.findMany({
        where: { organizationId, reversalOfJournalEntryId: journal.id, status: 'POSTED' },
        select: { id: true, journalNumber: true, accountingDate: true },
        orderBy: { accountingDate: 'asc' },
      }),
      journal.reversalOfJournalEntryId
        ? prisma.journalEntry.findFirst({
            where: { organizationId, id: journal.reversalOfJournalEntryId },
            select: { id: true, journalNumber: true, accountingDate: true },
          })
        : Promise.resolve(null),
      prisma.journalEntry.findFirst({
        where: { organizationId, replacedByJournalEntryId: journal.id },
        select: { id: true, createdBy: true, createdAt: true },
      }),
    ]);
    return { reversals, reversalOf, draft };
  }

  async userNames(prisma: TenantPrisma, ids: (string | null | undefined)[]) {
    const wanted = [...new Set(ids.filter((x): x is string => !!x))];
    if (wanted.length === 0) return new Map<string, string>();
    const users = await prisma.user.findMany({ where: { id: { in: wanted } }, select: { id: true, firstName: true, lastName: true, email: true } });
    return new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || u.email] as const));
  }

  /**
   * GL-J — every posted entry in a date range, whatever posted it (invoice, bill, receipt, payment,
   * transfer, manual journal), with its total. The ledger's day book.
   */
  async postedEntries(prisma: TenantPrisma, organizationId: string, from: Date, to: Date) {
    const rows = await prisma.journalEntry.findMany({
      // A posted manual journal leaves its authoring row behind, empty and pointing at the entry
      // that holds its lines (G-1); that row is not an entry of its own.
      where: { organizationId, status: 'POSTED', replacedByJournalEntryId: null, accountingDate: { gte: from, lte: to } },
      select: {
        id: true, journalNumber: true, accountingDate: true, description: true, currencyCode: true,
        sourceDocumentType: true, sourceDocumentId: true, entryPurpose: true, reversalOfJournalEntryId: true,
        postedAt: true, createdAt: true,
        lines: { select: { debitAmount: true } },
      },
      orderBy: [{ accountingDate: 'desc' }, { journalNumber: 'desc' }],
    });
    return rows.map(({ lines, ...r }) => ({
      ...r,
      totalAmount: lines.reduce((sum, l) => sum.plus(l.debitAmount as unknown as Decimal), new Decimal(0)).toFixed(2),
    }));
  }
}
