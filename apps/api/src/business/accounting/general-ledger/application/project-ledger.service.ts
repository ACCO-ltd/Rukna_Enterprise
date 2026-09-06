import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { ProjectLedgerResponse, RequestIdentity } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';

export interface ProjectLedgerQuery {
  fromDate?: string;
  toDate?: string;
  /** Page size. Capped server-side — a project's ledger is unbounded. */
  limit?: number;
  /** Rows to skip. */
  offset?: number;
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/**
 * Every posted journal line carrying this project, newest first.
 *
 * The drill-down under every figure in the Finance workspace. The existing account ledger
 * (`GET /accounting/ledger/:accountId`) cannot serve this: it is account-first, so answering
 * "show me the postings behind this project's cost" would mean walking the chart of accounts
 * one at a time. It also computes its opening balance without applying the dimension filter,
 * so its running balance is wrong the moment a project filter is passed — which is exactly
 * the shape a project ledger needs.
 *
 * There is deliberately no running balance here. A running balance is meaningful down one
 * account, where the rows share a normal balance and accumulate to something a person can
 * check. Down a project the rows are revenue, cost of sales, expenses, receivables and cash
 * interleaved, and a number that adds a revenue credit to a cost debit is not a balance
 * anyone can reconcile. Totals are reported per class instead.
 */
@Injectable()
export class ProjectLedgerService {
  constructor(private readonly tenancy: TenancyService) {}

  async getForProject(
    identity: RequestIdentity,
    projectId: string,
    query: ProjectLedgerQuery,
  ): Promise<ProjectLedgerResponse> {
    const prisma = this.tenancy.getClient();
    const orgId = identity.activeOrganizationId;

    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const offset = query.offset ?? 0;
    const from = query.fromDate ? new Date(query.fromDate) : undefined;
    const to = query.toDate ? new Date(query.toDate) : undefined;

    const where = {
      projectId,
      entry: {
        organizationId: orgId,
        status: 'POSTED' as const,
        ...(from || to
          ? { accountingDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
          : {}),
      },
    };

    const [total, rows] = await Promise.all([
      prisma.journalLine.count({ where }),
      prisma.journalLine.findMany({
        where,
        orderBy: [{ entry: { accountingDate: 'desc' } }, { entry: { journalNumber: 'desc' } }, { lineNumber: 'asc' }],
        skip: offset,
        take: limit,
        include: {
          entry: {
            select: {
              journalNumber: true,
              accountingDate: true,
              documentDate: true,
              description: true,
              sourceDocumentType: true,
              sourceDocumentId: true,
              entryPurpose: true,
            },
          },
          account: { select: { code: true } },
        },
      }),
    ]);

    // Class totals over the WHOLE filtered set, not just the page — a total that changes
    // when you turn the page is not a total.
    const totals = await this.classTotals(prisma, orgId, projectId, from, to);

    return {
      projectId,
      fromDate: query.fromDate ?? null,
      toDate: query.toDate ?? null,
      total,
      limit,
      offset,
      ...totals,
      lines: rows.map((line) => ({
        journalEntryId: line.journalEntryId,
        journalNumber: line.entry.journalNumber,
        accountingDate: line.entry.accountingDate.toISOString().slice(0, 10),
        documentDate: line.entry.documentDate.toISOString().slice(0, 10),
        description: line.entry.description,
        lineDescription: line.description,
        entryPurpose: line.entry.entryPurpose,
        accountId: line.accountId,
        // The snapshot, not the account's current name: what the account was called when
        // this line posted is the fact the audit trail needs.
        accountCode: line.accountCodeSnapshot || line.account.code,
        accountName: line.accountNameSnapshot,
        debitAmount: new Decimal(line.debitAmount.toString()).toFixed(2),
        creditAmount: new Decimal(line.creditAmount.toString()).toFixed(2),
        sourceDocumentType: line.entry.sourceDocumentType,
        sourceDocumentId: line.entry.sourceDocumentId,
        boqNodeId: line.boqNodeId,
        spendCategoryId: line.spendCategoryId,
        supplierId: line.supplierId,
        clientId: line.clientId,
        contractId: line.contractId,
      })),
    };
  }

  /** Revenue / cost-of-sales / expense totals for the filtered set, excluding CLOSING. */
  private async classTotals(
    prisma: ReturnType<TenancyService['getClient']>,
    orgId: string,
    projectId: string,
    from: Date | undefined,
    to: Date | undefined,
  ) {
    const accounts = await prisma.account.findMany({
      where: { organizationId: orgId },
      select: { id: true, versions: { orderBy: { effectiveFrom: 'desc' }, take: 1 } },
    });
    const classOf = new Map(accounts.map((a) => [a.id, a.versions[0]?.accountClass ?? null]));

    const agg = await prisma.journalLine.groupBy({
      by: ['accountId'],
      where: {
        projectId,
        entry: {
          organizationId: orgId,
          status: 'POSTED',
          entryPurpose: { not: 'CLOSING' },
          ...(from || to
            ? { accountingDate: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
            : {}),
        },
      },
      _sum: { debitAmount: true, creditAmount: true },
    });

    let revenue = new Decimal(0);
    let cost = new Decimal(0);
    for (const row of agg) {
      const cls = classOf.get(row.accountId);
      const debit = new Decimal((row._sum.debitAmount ?? 0).toString());
      const credit = new Decimal((row._sum.creditAmount ?? 0).toString());
      if (cls === 'INCOME') revenue = revenue.plus(credit.minus(debit));
      else if (cls === 'COST_OF_SALES' || cls === 'EXPENSE') cost = cost.plus(debit.minus(credit));
    }

    return { totalRevenue: revenue.toFixed(2), totalCost: cost.toFixed(2) };
  }
}
