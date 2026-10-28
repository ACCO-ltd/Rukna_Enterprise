import { ForbiddenException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import {
  PERMISSIONS,
  type AgingBucketKey,
  type AgingDocument,
  type AgingPartyRow,
  type AgingReport,
  type AgingSide,
  type RequestIdentity,
} from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { AGING_ORDER, agingBucket, daysPastDue } from '../domain/aging.js';
import { FinanceHomeRepository } from '../infrastructure/finance-home.repository.js';

const ZERO = new Decimal(0);
const day = (d: Date) => d.toISOString().slice(0, 10);

interface OpenItem {
  party: { id: string; code: string; name: string };
  document: Omit<AgingDocument, 'daysLate' | 'bucket' | 'outstanding' | 'dueDate'> & { due: Date };
  outstanding: Decimal;
}

/**
 * Step 6 — the aging reports: every open invoice (receivables) or bill (payables), by party and
 * by days past due, with the documents behind each figure. Built on the same buckets and the same
 * "open" rule as Finance Home, so the two never disagree. As of today: an as-of-a-past-date aging
 * would need each document's balance on that date, which is a different report.
 */
@Injectable()
export class AgingReportService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: FinanceHomeRepository,
  ) {}

  async report(identity: RequestIdentity, side: AgingSide, now: Date = new Date()): Promise<AgingReport> {
    this.assertMayRead(identity, side);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    const items: OpenItem[] = side === 'receivables'
      ? (await this.repo.agingInvoices(prisma, org)).map((inv) => ({
          party: inv.client,
          outstanding: new Decimal(inv.outstandingAmount.toString()),
          // An invoice without a due date is due on its date (the Finance Home rule).
          document: { id: inv.id, number: inv.invoiceNumber, date: day(inv.invoiceDate), due: inv.dueDate ?? inv.invoiceDate, opening: inv.postingStatus === 'OPENING_BALANCE' },
        }))
      : (await this.repo.agingBills(prisma, org)).map((bill) => ({
          party: bill.supplier,
          outstanding: new Decimal(bill.outstandingAmount.toString()),
          document: { id: bill.id, number: bill.billNumber ?? bill.supplierInvoiceNumber, date: day(bill.billDate), due: bill.dueDate, opening: bill.postingStatus === 'OPENING_BALANCE' },
        }));

    const emptyBuckets = () => new Map<AgingBucketKey, Decimal>(AGING_ORDER.map((k) => [k, ZERO]));
    const totals = emptyBuckets();
    const parties = new Map<string, { party: OpenItem['party']; buckets: Map<AgingBucketKey, Decimal>; total: Decimal; oldest: number; documents: AgingDocument[] }>();

    for (const item of items) {
      const late = daysPastDue(item.document.due, now);
      const bucket = agingBucket(late);
      const row = parties.get(item.party.id) ?? { party: item.party, buckets: emptyBuckets(), total: ZERO, oldest: 0, documents: [] };
      row.buckets.set(bucket, row.buckets.get(bucket)!.plus(item.outstanding));
      row.total = row.total.plus(item.outstanding);
      row.oldest = Math.max(row.oldest, late);
      const { due, ...doc } = item.document;
      row.documents.push({ ...doc, dueDate: day(due), outstanding: item.outstanding.toFixed(2), daysLate: Math.max(late, 0), bucket });
      parties.set(item.party.id, row);
      totals.set(bucket, totals.get(bucket)!.plus(item.outstanding));
    }

    const asRecord = (m: Map<AgingBucketKey, Decimal>) =>
      Object.fromEntries(AGING_ORDER.map((k) => [k, m.get(k)!.toFixed(2)])) as Record<AgingBucketKey, string>;
    const rows: AgingPartyRow[] = [...parties.values()]
      .sort((a, b) => b.total.comparedTo(a.total) || a.party.name.localeCompare(b.party.name))
      .map((r) => ({
        partyId: r.party.id,
        partyCode: r.party.code,
        partyName: r.party.name,
        buckets: asRecord(r.buckets),
        total: r.total.toFixed(2),
        oldestDaysLate: r.oldest,
        documents: r.documents.sort((a, b) => b.daysLate - a.daysLate || a.dueDate.localeCompare(b.dueDate)),
      }));
    const total = [...totals.values()].reduce((s, v) => s.plus(v), ZERO);
    return { side, asOf: day(now), totals: asRecord(totals), total: total.toFixed(2), rows };
  }

  private assertMayRead(identity: RequestIdentity, side: AgingSide): void {
    const has = (p: string) => identity.permissions.includes('*') || identity.permissions.includes(p);
    const viewer = has(PERMISSIONS.accountingView) || has(PERMISSIONS.accountingManage);
    const own = side === 'receivables' ? has(PERMISSIONS.receivablesManage) : has(PERMISSIONS.payablesManage);
    if (!viewer && !own) {
      throw new ForbiddenException({
        errorCode: 'FORBIDDEN',
        message: side === 'receivables' ? 'The receivables aging needs Manage receivables or View accounting.' : 'The payables aging needs Manage payables or View accounting.',
      });
    }
  }
}
