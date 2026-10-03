import { BadRequestException } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

import { PostingAccountResolver } from '../../accounting-core/application/posting-account-resolver.service.js';
import { AccountRepository } from '../../accounting-core/infrastructure/account.repository.js';
import { OPENING_BALANCE_EVENT, type OpeningBalanceApTieOut } from '../domain/supplier-bill-eligibility.policy.js';

type Db = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * The AP control account, resolved the way the payment screens resolve the `apAccountCode` they
 * send to `POST /payments/:id/post`: the single ACTIVE account whose current version is
 * ACCOUNTS_PAYABLE (ADR-024 ACC-POST-001). Not configured / ambiguous → null.
 */
export async function resolveApControlAccount(db: Db, organizationId: string): Promise<{ id: string; code: string } | null> {
  try {
    return await new PostingAccountResolver(new AccountRepository()).resolve(db, organizationId, 'ACCOUNTS_PAYABLE');
  } catch (e) {
    if (e instanceof BadRequestException) return null;
    throw e;
  }
}

/**
 * Load the facts for `openingBalanceApTieOutProblem` against `apAccount` (the account the payment
 * debits). The opening-balance journal is the import's EVT-OPB-001 entry (sourceDocumentType
 * OPENING_BALANCE), POSTED and not reversed by a posted reversal.
 */
export async function loadOpeningBalanceApTieOut(
  db: Db,
  organizationId: string,
  apAccount: { id: string; code: string } | null,
): Promise<OpeningBalanceApTieOut> {
  const journals = await db.journalEntry.findMany({
    where: {
      organizationId,
      sourceDocumentType: 'OPENING_BALANCE',
      accountingEventId: OPENING_BALANCE_EVENT,
      status: 'POSTED',
      reversals: { none: { status: 'POSTED' } },
    },
    select: { id: true, journalNumber: true },
    orderBy: { createdAt: 'asc' },
  });

  const bills = await db.supplierBill.aggregate({
    where: { organizationId, postingStatus: 'OPENING_BALANCE' },
    _sum: { totalAmount: true },
  });
  const importedBillsTotal = new Decimal(bills._sum.totalAmount?.toString() ?? '0');

  let journalNetCredit = new Decimal(0);
  if (apAccount && journals.length > 0) {
    const sum = await db.journalLine.aggregate({
      where: { accountId: apAccount.id, journalEntryId: { in: journals.map((j) => j.id) } },
      _sum: { debitAmount: true, creditAmount: true },
    });
    journalNetCredit = new Decimal(sum._sum.creditAmount?.toString() ?? '0').minus(
      new Decimal(sum._sum.debitAmount?.toString() ?? '0'),
    );
  }

  return {
    apAccount,
    journal: journals.length > 0 ? { journalNumber: journals.map((j) => j.journalNumber ?? '—').join(', ') } : null,
    journalNetCredit,
    importedBillsTotal,
  };
}
