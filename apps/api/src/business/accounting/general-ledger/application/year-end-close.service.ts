import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import {
  ACCOUNTING_POSTING_PORT,
  type IAccountingPostingPort,
} from '../../accounting-core/application/ports/accounting-posting.port.js';
import { DocumentSequenceRepository } from '../../accounting-core/infrastructure/document-sequence.repository.js';
import { SnapshotService } from './snapshot.service.js';

export interface YearEndCloseResult {
  fiscalYearId: string;
  closingJournalId: string;
  closingJournalNumber: string;
  netIncome: string;
  period12SnapshotAccounts: number;
}

@Injectable()
export class YearEndCloseService {
  constructor(
    private readonly tenancyService: TenancyService,
    private readonly snapshotService: SnapshotService,
    private readonly sequenceRepo: DocumentSequenceRepository,
    @Inject(ACCOUNTING_POSTING_PORT)
    private readonly postingPort: IAccountingPostingPort,
  ) {}

  /**
   * Execute year-end close for a fiscal year.
   *
   * Requirements:
   * - Fiscal year must be OPEN
   * - Period 12 (final period) must be LOCKED
   * - No closing journal already posted for this FY
   *
   * Steps:
   * 1. Compute net P&L for the year (all INCOME/COST_OF_SALES/EXPENSE accounts,
   *    excluding CLOSING entries)
   * 2. Post CLOSING journal: zero out all P&L accounts → Retained Earnings
   * 3. Generate Period 12 snapshot (includes the closing journal)
   * 4. Mark Period 12 CLOSED
   * 5. Mark FiscalYear CLOSED
   */
  async closeYear(
    identity: RequestIdentity,
    fiscalYearId: string,
  ): Promise<YearEndCloseResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId, userId } = identity;

    // ── Validate fiscal year state ─────────────────────────────────────────────
    const fy = await prisma.fiscalYear.findFirst({
      where: { id: fiscalYearId, organizationId: orgId },
      include: {
        periods: { orderBy: { periodNumber: 'asc' } },
      },
    });
    if (!fy) throw new NotFoundException(`Fiscal year ${fiscalYearId} not found`);
    if (fy.status === 'CLOSED') {
      throw new ConflictException(`Fiscal year ${fy.name} is already closed`);
    }
    if (fy.status !== 'OPEN' && fy.status !== 'LOCKED') {
      throw new BadRequestException(`Fiscal year must be OPEN to close`);
    }

    const period12 = fy.periods.find((p) => p.periodNumber === 12);
    if (!period12) throw new BadRequestException(`Fiscal year ${fy.name} has no Period 12`);
    if (period12.status !== 'LOCKED') {
      throw new BadRequestException(
        `Period 12 (${period12.name}) must be LOCKED before year-end close (current: ${period12.status})`,
      );
    }

    // Verify all prior periods are CLOSED
    const openPriors = fy.periods.filter(
      (p) => p.periodNumber < 12 && p.status !== 'CLOSED',
    );
    if (openPriors.length > 0) {
      const names = openPriors.map((p) => p.name).join(', ');
      throw new BadRequestException(
        `Periods 1–11 must all be CLOSED before year-end close. Still open: ${names}`,
      );
    }

    // Idempotency: check for existing closing journal
    const existingClose = await prisma.journalEntry.findFirst({
      where: {
        organizationId: orgId,
        sourceDocumentType: 'YEAR_END_CLOSE',
        sourceDocumentId: fiscalYearId,
        accountingEventId: 'EVT-YE-001',
      },
    });
    if (existingClose) {
      throw new ConflictException(
        `Closing journal already posted for ${fy.name} (${existingClose.journalNumber})`,
      );
    }

    // ── Compute P&L for the year ───────────────────────────────────────────────
    const plAccountClasses = ['INCOME', 'COST_OF_SALES', 'EXPENSE'];

    const plAccounts = await prisma.account.findMany({
      where: {
        organizationId: orgId,
        versions: {
          some: {
            accountClass: { in: plAccountClasses as never[] },
            isPostingAllowed: true,
          },
        },
      },
      include: {
        versions: {
          where: { accountClass: { in: plAccountClasses as never[] } },
          orderBy: { effectiveFrom: 'desc' },
          take: 1,
        },
      },
    });

    const closingLines: Array<{
      accountId: string;
      debitAmount?: Decimal;
      creditAmount?: Decimal;
      transactionCurrencyCode: string;
      baseCurrencyAmount: Decimal;
      memo: string;
    }> = [];

    let netPL = new Decimal(0); // positive = income, negative = loss

    for (const account of plAccounts) {
      // Sum all POSTED journal lines for this account in the FY, excluding CLOSING entries
      const agg = await prisma.journalLine.aggregate({
        where: {
          accountId: account.id,
          entry: {
            organizationId: orgId,
            status: 'POSTED',
            accountingPeriodId: { in: fy.periods.map((p) => p.id) },
            entryPurpose: { not: 'CLOSING' },
          },
        },
        _sum: { debitAmount: true, creditAmount: true },
      });

      const totalDebit = new Decimal(agg._sum.debitAmount?.toString() ?? '0');
      const totalCredit = new Decimal(agg._sum.creditAmount?.toString() ?? '0');
      const netBalance = totalDebit.minus(totalCredit); // positive = debit-heavy

      if (netBalance.isZero()) continue;

      const accountClass = account.versions[0]?.accountClass;
      const currencyCode = 'USD'; // base currency

      if (netBalance.gt(0)) {
        // Debit-heavy (normal for EXPENSE/COST_OF_SALES): Cr to zero
        closingLines.push({
          accountId: account.id,
          creditAmount: netBalance,
          transactionCurrencyCode: currencyCode,
          baseCurrencyAmount: netBalance,
          memo: `Year-end close — ${accountClass}`,
        });
        if (accountClass === 'INCOME') {
          netPL = netPL.minus(netBalance); // debit-heavy income is a loss on that account
        } else {
          netPL = netPL.minus(netBalance); // expenses reduce net income
        }
      } else {
        // Credit-heavy (normal for INCOME): Dr to zero
        const absBalance = netBalance.abs();
        closingLines.push({
          accountId: account.id,
          debitAmount: absBalance,
          transactionCurrencyCode: currencyCode,
          baseCurrencyAmount: absBalance,
          memo: `Year-end close — ${accountClass}`,
        });
        if (accountClass === 'INCOME') {
          netPL = netPL.plus(absBalance); // credit-heavy income increases net income
        } else {
          netPL = netPL.plus(absBalance); // this would be unusual (credit-heavy expense)
        }
      }
    }

    if (closingLines.length === 0) {
      throw new BadRequestException(
        `No P&L activity found for ${fy.name}. Ensure income/expense accounts have posted journals.`,
      );
    }

    // Add Retained Earnings entry
    const baseCurrency = 'USD';
    if (netPL.gt(0)) {
      // Net income → Cr Retained Earnings
      closingLines.push({
        accountId: fy.retainedEarningsAccountId,
        creditAmount: netPL,
        transactionCurrencyCode: baseCurrency,
        baseCurrencyAmount: netPL,
        memo: `Net income for ${fy.name}`,
      });
    } else if (netPL.lt(0)) {
      // Net loss → Dr Retained Earnings
      const lossAmount = netPL.abs();
      closingLines.push({
        accountId: fy.retainedEarningsAccountId,
        debitAmount: lossAmount,
        transactionCurrencyCode: baseCurrency,
        baseCurrencyAmount: lossAmount,
        memo: `Net loss for ${fy.name}`,
      });
    }

    // ── Post CLOSING journal ───────────────────────────────────────────────────
    const result = await prisma.$transaction(async (tx) => {
      return this.postingPort.post(
        {
          organizationId: orgId,
          accountingDate: period12.endDate,
          documentDate: period12.endDate,
          description: `Year-end close — ${fy.name}`,
          currencyCode: baseCurrency,
          eventType: 'EVT-YE-001',
          sourceDocumentType: 'YEAR_END_CLOSE',
          sourceDocumentId: fiscalYearId,
          journalCategory: 'YEAR_END_CLOSE',
          entryPurpose: 'CLOSING',
          postingOrigin: 'SYSTEM_YEAR_END',
          createdBy: userId,
          approvedBy: userId,
          lines: closingLines.map((l) => ({
            accountId: l.accountId,
            debitAmount: l.debitAmount,
            creditAmount: l.creditAmount,
            transactionCurrencyCode: l.transactionCurrencyCode,
            baseCurrencyAmount: l.baseCurrencyAmount,
            memo: l.memo,
          })),
        },
        tx as never,
      );
    });

    // ── Generate Period 12 snapshot (includes closing journal) ────────────────
    const snapshot = await this.snapshotService.generateForPeriod(orgId, period12.id, userId);

    // ── Close Period 12 and FiscalYear ────────────────────────────────────────
    await prisma.accountingPeriod.update({
      where: { id: period12.id },
      data: { status: 'CLOSED' },
    });

    await prisma.fiscalYear.update({
      where: { id: fiscalYearId },
      data: { status: 'CLOSED', closedAt: new Date(), closedBy: userId },
    });

    return {
      fiscalYearId,
      closingJournalId: result.journalEntryId,
      closingJournalNumber: result.journalNumber,
      netIncome: netPL.toFixed(2),
      period12SnapshotAccounts: snapshot.accountsSnapshotted,
    };
  }
}
