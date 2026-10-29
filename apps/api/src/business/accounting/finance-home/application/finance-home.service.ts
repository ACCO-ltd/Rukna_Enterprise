import { Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type AgingBucketKey,
  type FinanceHome,
  type FinanceHomeCash,
  type FinanceHomeMonth,
  type FinanceHomePayables,
  type FinanceHomeReceivables,
  type PermissionKey,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AGING_ORDER, agingBucket, daysPastDue, monthBounds } from '../domain/aging.js';
import { FinanceHomeRepository } from '../infrastructure/finance-home.repository.js';

const ZERO = new Decimal(0);
const money = (d: Decimal | null | undefined) => (d ?? ZERO).toFixed(2);
const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Step 4 (ADR-047 §4) — Finance Home: cash in each bank, what clients owe and how late, what is
 * owed to suppliers and when, and this month's money in and out. A section is computed only for a
 * caller who may read it: cash and the month for accounting viewers, receivables for
 * `manage:receivable`, payables for `manage:payable` (accounting viewers see all).
 */
@Injectable()
export class FinanceHomeService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: FinanceHomeRepository,
  ) {}

  async home(identity: RequestIdentity, now: Date = new Date()): Promise<FinanceHome> {
    const has = (p: PermissionKey) => identity.permissions.includes(p);
    const viewer = has(PERMISSIONS.accountingView) || has(PERMISSIONS.accountingManage);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    const [cash, receivables, payables, month] = await Promise.all([
      viewer ? this.cash(prisma, org) : null,
      viewer || has(PERMISSIONS.receivablesManage) ? this.receivables(prisma, org, now) : null,
      viewer || has(PERMISSIONS.payablesManage) ? this.payables(prisma, org, now) : null,
      viewer ? this.month(prisma, org, now) : null,
    ]);
    return { asOf: day(now), cash, receivables, payables, month };
  }

  private async cash(prisma: ReturnType<TenancyService['getClient']>, org: string): Promise<FinanceHomeCash> {
    const banks = await this.repo.bankAccounts(prisma, org);
    const sums = await this.repo.glBalances(prisma, org, banks.map((b) => b.glAccountId));
    const byAccount = new Map(sums.map((s) => [s.accountId, (s._sum.debitAmount ?? ZERO).minus(s._sum.creditAmount ?? ZERO)]));
    const accounts = banks.map((b) => ({
      bankAccountId: b.id,
      bankName: b.bankName,
      accountName: b.accountName,
      balance: money(byAccount.get(b.glAccountId)),
    }));
    const total = banks.reduce((sum, b) => sum.plus(byAccount.get(b.glAccountId) ?? ZERO), ZERO);
    return { total: money(total), accounts };
  }

  private async receivables(prisma: ReturnType<TenancyService['getClient']>, org: string, now: Date): Promise<FinanceHomeReceivables> {
    const invoices = await this.repo.openInvoices(prisma, org);
    const buckets = new Map<AgingBucketKey, { amount: Decimal; count: number }>(AGING_ORDER.map((k) => [k, { amount: ZERO, count: 0 }]));
    const byClient = new Map<string, { clientName: string; overdue: Decimal; oldest: number }>();
    let outstanding = ZERO;
    let overdue = ZERO;
    for (const inv of invoices) {
      const owed = new Decimal(inv.outstandingAmount.toString());
      // An invoice without a due date is due on its date.
      const late = daysPastDue(inv.dueDate ?? inv.invoiceDate, now);
      const bucket = buckets.get(agingBucket(late))!;
      bucket.amount = bucket.amount.plus(owed);
      bucket.count += 1;
      outstanding = outstanding.plus(owed);
      if (late > 0) {
        overdue = overdue.plus(owed);
        const c = byClient.get(inv.clientId) ?? { clientName: inv.client.name, overdue: ZERO, oldest: 0 };
        c.overdue = c.overdue.plus(owed);
        c.oldest = Math.max(c.oldest, late);
        byClient.set(inv.clientId, c);
      }
    }
    const topOverdue = [...byClient.entries()]
      .sort(([, a], [, b]) => b.overdue.comparedTo(a.overdue))
      .slice(0, 5)
      .map(([clientId, c]) => ({ clientId, clientName: c.clientName, overdue: money(c.overdue), oldestDaysLate: c.oldest }));
    return {
      outstanding: money(outstanding),
      overdue: money(overdue),
      aging: AGING_ORDER.map((key) => ({ key, amount: money(buckets.get(key)!.amount), count: buckets.get(key)!.count })),
      topOverdue,
    };
  }

  private async payables(prisma: ReturnType<TenancyService['getClient']>, org: string, now: Date): Promise<FinanceHomePayables> {
    const bills = await this.repo.openBills(prisma, org);
    let outstanding = ZERO;
    let overdue = ZERO;
    let dueThisWeek = ZERO;
    let dueThisWeekCount = 0;
    for (const bill of bills) {
      const owed = new Decimal(bill.outstandingAmount.toString());
      const late = daysPastDue(bill.dueDate, now);
      outstanding = outstanding.plus(owed);
      if (late > 0) overdue = overdue.plus(owed);
      else if (late >= -7) {
        dueThisWeek = dueThisWeek.plus(owed);
        dueThisWeekCount += 1;
      }
    }
    return { outstanding: money(outstanding), overdue: money(overdue), dueThisWeek: money(dueThisWeek), dueThisWeekCount };
  }

  private async month(prisma: ReturnType<TenancyService['getClient']>, org: string, now: Date): Promise<FinanceHomeMonth> {
    const { from, to } = monthBounds(now);
    const [invoiced, collected, paid] = await Promise.all([
      this.repo.invoicedBetween(prisma, org, from, to),
      this.repo.collectedBetween(prisma, org, from, to),
      this.repo.paidBetween(prisma, org, from, to),
    ]);
    return { from: day(from), to: day(to), invoiced: money(invoiced), collected: money(collected), paid: money(paid) };
  }
}
