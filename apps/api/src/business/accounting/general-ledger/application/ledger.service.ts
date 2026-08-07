import { Injectable, NotFoundException } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity } from '@erp/types';
import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

export interface LedgerLineDto {
  journalEntryId: string;
  journalNumber: string;
  accountingDate: string;
  documentDate: string;
  description: string;
  reference: string | null;
  debitAmount: string;
  creditAmount: string;
  runningBalance: string;
  sourceDocumentType: string | null;
  sourceDocumentId: string | null;
  projectId: string | null;
  departmentId: string | null;
  costCenterId: string | null;
}

export interface AccountLedgerResult {
  accountId: string;
  accountCode: string;
  accountName: string;
  openingBalance: string;
  periodDebit: string;
  periodCredit: string;
  closingBalance: string;
  lines: LedgerLineDto[];
}

export interface LedgerQueryDto {
  accountId: string;
  fromDate: string;
  toDate: string;
  projectId?: string;
  departmentId?: string;
  costCenterId?: string;
}

export interface GlBalanceResult {
  accountId: string;
  accountCode: string;
  asOfDate: string;
  debitTotal: string;
  creditTotal: string;
  netBalance: string;
}

@Injectable()
export class LedgerService {
  constructor(private readonly tenancyService: TenancyService) {}

  /**
   * Account ledger with running balance.
   * Returns opening balance (sum of all posted lines before fromDate),
   * then each posted journal line in the date range with a running balance.
   */
  async getAccountLedger(
    identity: RequestIdentity,
    dto: LedgerQueryDto,
  ): Promise<AccountLedgerResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const account = await prisma.account.findFirst({
      where: { id: dto.accountId, organizationId: orgId },
      include: {
        versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 },
      },
    });
    if (!account) throw new NotFoundException(`Account ${dto.accountId} not found`);

    const from = new Date(dto.fromDate);
    const to = new Date(dto.toDate);

    // Opening balance: all POSTED lines before fromDate
    const openingAgg = await prisma.journalLine.aggregate({
      where: {
        accountId: dto.accountId,
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          accountingDate: { lt: from },
        },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const openingDebit = new Decimal(openingAgg._sum.debitAmount?.toString() ?? '0');
    const openingCredit = new Decimal(openingAgg._sum.creditAmount?.toString() ?? '0');
    const openingBalance = openingDebit.minus(openingCredit);

    // Period journal lines (with dimension filters)
    const dimensionFilter: Record<string, string> = {};
    if (dto.projectId) dimensionFilter.projectId = dto.projectId;
    if (dto.departmentId) dimensionFilter.departmentId = dto.departmentId;
    if (dto.costCenterId) dimensionFilter.costCenterId = dto.costCenterId;

    const lines = await prisma.journalLine.findMany({
      where: {
        accountId: dto.accountId,
        ...(Object.keys(dimensionFilter).length ? dimensionFilter : {}),
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          accountingDate: { gte: from, lte: to },
        },
      },
      include: {
        entry: {
          select: {
            journalNumber: true,
            accountingDate: true,
            documentDate: true,
            description: true,
            sourceDocumentType: true,
            sourceDocumentId: true,
          },
        },
      },
      orderBy: [
        { entry: { accountingDate: 'asc' } },
        { entry: { journalNumber: 'asc' } },
        { lineNumber: 'asc' },
      ],
    });

    let runningBalance = openingBalance;
    let periodDebit = new Decimal(0);
    let periodCredit = new Decimal(0);

    const ledgerLines: LedgerLineDto[] = lines.map((line) => {
      const debit = new Decimal(line.debitAmount.toString());
      const credit = new Decimal(line.creditAmount.toString());
      periodDebit = periodDebit.plus(debit);
      periodCredit = periodCredit.plus(credit);
      runningBalance = runningBalance.plus(debit).minus(credit);

      return {
        journalEntryId: line.journalEntryId,
        journalNumber: line.entry.journalNumber ?? '',
        accountingDate: line.entry.accountingDate.toISOString().slice(0, 10),
        documentDate: line.entry.documentDate.toISOString().slice(0, 10),
        description: line.entry.description ?? line.description ?? '',
        reference: line.description,
        debitAmount: debit.toFixed(2),
        creditAmount: credit.toFixed(2),
        runningBalance: runningBalance.toFixed(2),
        sourceDocumentType: line.entry.sourceDocumentType,
        sourceDocumentId: line.entry.sourceDocumentId,
        projectId: (line as Record<string, unknown>).projectId as string | null,
        departmentId: (line as Record<string, unknown>).departmentId as string | null,
        costCenterId: (line as Record<string, unknown>).costCenterId as string | null,
      };
    });

    return {
      accountId: account.id,
      accountCode: account.code,
      accountName: account.versions[0]?.name ?? account.code,
      openingBalance: openingBalance.toFixed(2),
      periodDebit: periodDebit.toFixed(2),
      periodCredit: periodCredit.toFixed(2),
      closingBalance: runningBalance.toFixed(2),
      lines: ledgerLines,
    };
  }

  /**
   * GL balance for a single account as of a specific date.
   */
  async getGlBalance(
    identity: RequestIdentity,
    accountId: string,
    asOfDate: string,
  ): Promise<GlBalanceResult> {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    const account = await prisma.account.findFirst({
      where: { id: accountId, organizationId: orgId },
      include: { versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });
    if (!account) throw new NotFoundException(`Account ${accountId} not found`);

    const asOf = new Date(asOfDate);

    const agg = await prisma.journalLine.aggregate({
      where: {
        accountId,
        entry: { organizationId: orgId, status: 'POSTED', accountingDate: { lte: asOf } },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    const debitTotal = new Decimal(agg._sum.debitAmount?.toString() ?? '0');
    const creditTotal = new Decimal(agg._sum.creditAmount?.toString() ?? '0');

    return {
      accountId: account.id,
      accountCode: account.code,
      asOfDate,
      debitTotal: debitTotal.toFixed(2),
      creditTotal: creditTotal.toFixed(2),
      netBalance: debitTotal.minus(creditTotal).toFixed(2),
    };
  }

  /**
   * Source document drill-down: return all journal entries linked to a document.
   */
  async drillDown(
    identity: RequestIdentity,
    sourceDocumentType: string,
    sourceDocumentId: string,
  ) {
    const prisma = this.tenancyService.getClient();
    const { activeOrganizationId: orgId } = identity;

    return prisma.journalEntry.findMany({
      where: { organizationId: orgId, sourceDocumentType: sourceDocumentType as never, sourceDocumentId },
      include: {
        lines: {
          orderBy: { lineNumber: 'asc' },
          include: {
            account: { select: { code: true } },
          },
        },
      },
      orderBy: { accountingDate: 'asc' },
    });
  }
}
