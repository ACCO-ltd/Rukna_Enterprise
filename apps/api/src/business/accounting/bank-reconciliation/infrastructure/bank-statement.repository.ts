import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Decimal } from '@prisma/client/runtime/library';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

type Db = Prisma.TransactionClient | ReturnType<TenancyService['getClient']>;

const LEDGER_SELECT = {
  id: true,
  debitAmount: true,
  creditAmount: true,
  description: true,
  entry: { select: { id: true, journalNumber: true, accountingDate: true } },
} as const;

/** Step 6 — the reads and writes of bank reconciliation. */
@Injectable()
export class BankStatementRepository {
  constructor(private readonly tenancy: TenancyService) {}

  db() {
    return this.tenancy.getClient();
  }

  bankAccount(db: Db, organizationId: string, id: string) {
    return db.bankAccount.findFirst({
      where: { id, organizationId },
      select: { id: true, bankName: true, accountName: true, currencyCode: true, glAccountId: true },
    });
  }

  list(db: Db, organizationId: string, bankAccountId?: string) {
    return db.bankStatement.findMany({
      where: { organizationId, ...(bankAccountId ? { bankAccountId } : {}) },
      orderBy: [{ statementDate: 'desc' }, { createdAt: 'desc' }],
      include: {
        bankAccount: { select: { bankName: true, accountName: true } },
        _count: { select: { lines: true } },
        lines: { where: { matchStatus: 'UNMATCHED' }, select: { id: true } },
      },
    });
  }

  find(db: Db, organizationId: string, id: string) {
    return db.bankStatement.findFirst({
      where: { id, organizationId },
      include: {
        bankAccount: { select: { bankName: true, accountName: true, glAccountId: true } },
        lines: { orderBy: { lineNumber: 'asc' }, include: { matchedJournalLine: { select: LEDGER_SELECT } } },
      },
    });
  }

  /** The latest reconciled statement of the account dated before this one. */
  previousReconciled(db: Db, organizationId: string, bankAccountId: string, before: Date) {
    return db.bankStatement.findFirst({
      where: { organizationId, bankAccountId, status: 'RECONCILED', statementDate: { lt: before } },
      orderBy: { statementDate: 'desc' },
      select: { closingBalance: true },
    });
  }

  /** Where reconciliation of the account began: the earliest imported statement's start. */
  async firstPeriodStart(db: Db, organizationId: string, bankAccountId: string): Promise<Date | null> {
    const first = await db.bankStatement.findFirst({ where: { organizationId, bankAccountId }, orderBy: { periodStart: 'asc' }, select: { periodStart: true } });
    return first?.periodStart ?? null;
  }

  create(tx: Prisma.TransactionClient, data: {
    organizationId: string; bankAccountId: string; periodStart: Date; statementDate: Date; currencyCode: string;
    openingBalance: Decimal; closingBalance: Decimal; fileName: string | null; createdBy: string;
    lines: Array<{ lineNumber: number; transactionDate: Date; description: string; reference: string | null; amount: Decimal }>;
  }) {
    const { lines, ...statement } = data;
    return tx.bankStatement.create({ data: { ...statement, lines: { create: lines } }, select: { id: true } });
  }

  /** Posted ledger lines on the bank's GL account dated up to `to` that no statement line has cleared. */
  uncleared(db: Db, organizationId: string, glAccountId: string, to: Date) {
    return db.journalLine.findMany({
      where: {
        accountId: glAccountId,
        statementMatch: { is: null },
        entry: { organizationId, status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { lte: to } },
      },
      select: LEDGER_SELECT,
      orderBy: [{ entry: { accountingDate: 'asc' } }, { entry: { journalNumber: 'asc' } }],
    });
  }

  async ledgerBalance(db: Db, organizationId: string, glAccountId: string, to: Date) {
    const sum = await db.journalLine.aggregate({
      where: { accountId: glAccountId, entry: { organizationId, status: { in: ['POSTED', 'REVERSED'] }, accountingDate: { lte: to } } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    return { debit: sum._sum.debitAmount, credit: sum._sum.creditAmount };
  }

  /** A ledger line, with what it is on and whether something has cleared it. */
  ledgerLine(db: Db, organizationId: string, journalLineId: string) {
    return db.journalLine.findFirst({
      where: { id: journalLineId, entry: { organizationId, status: { in: ['POSTED', 'REVERSED'] } } },
      select: { ...LEDGER_SELECT, accountId: true, statementMatch: { select: { id: true } } },
    });
  }

  setMatch(tx: Prisma.TransactionClient, lineId: string, data: {
    matchStatus: 'UNMATCHED' | 'MATCHED' | 'POSTED'; matchedJournalLineId: string | null;
    adjustmentJournalEntryId?: string | null; matchedAt: Date | null; matchedBy: string | null;
  }) {
    return tx.bankStatementLine.update({ where: { id: lineId }, data });
  }

  markReconciled(tx: Prisma.TransactionClient, id: string, userId: string) {
    return tx.bankStatement.update({ where: { id }, data: { status: 'RECONCILED', reconciledAt: new Date(), reconciledBy: userId } });
  }

  delete(tx: Prisma.TransactionClient, id: string) {
    return tx.bankStatement.delete({ where: { id } });
  }

  /** The bank-side line of a journal just posted from a statement line. */
  bankLineOf(tx: Prisma.TransactionClient, journalEntryId: string, glAccountId: string) {
    return tx.journalLine.findFirst({ where: { journalEntryId, accountId: glAccountId }, select: { id: true } });
  }

  account(db: Db, organizationId: string, id: string) {
    return db.account.findFirst({
      where: { id, organizationId },
      select: { id: true, code: true, versions: { orderBy: { versionNumber: 'desc' }, take: 1, select: { name: true, isPostingAllowed: true, isControlAccount: true } } },
    });
  }
}
