import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
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
import { balanceOn, existedOn, type DatedMovement } from '../domain/balance-as-of.js';
import { FinanceHomeRepository } from '../infrastructure/finance-home.repository.js';
import { pendingPaymentHolds } from '../../accounts-payable/infrastructure/pending-payment-holds.repository.js';

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
 * "open" rule as Finance Home, so the two never disagree today.
 *
 * AA (2026-10-30): payables too — as of any past day, with each supplier's money paid ahead.
 *
 * AG (2026-10-30), receivables: as of any past day (each invoice's balance rebuilt to that day,
 * AG-1); money each client holds on account and the net they owe, as their statement shows it
 * (AG-2); retention held (AG-3); and both sides say whether the total agrees with the control
 * account in the ledger on the same day (AG-4).
 */
@Injectable()
export class AgingReportService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: FinanceHomeRepository,
  ) {}

  async report(identity: RequestIdentity, side: AgingSide, asOfIso?: string, today: Date = new Date()): Promise<AgingReport> {
    this.assertMayRead(identity, side);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;
    const todayIso = day(today);
    const asOfDay = asOfIso ?? todayIso;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOfDay) || Number.isNaN(Date.parse(asOfDay)) || asOfDay > todayIso) {
      throw new BadRequestException({ errorCode: 'AS_OF_INVALID', message: 'Choose a day up to today (YYYY-MM-DD).' });
    }
    const historical = asOfDay < todayIso;
    const now = new Date(`${asOfDay}T00:00:00.000Z`);

    const book = side === 'receivables' ? await this.receivables(prisma, org, now, historical) : await this.payables(prisma, org, now, historical);
    const items: OpenItem[] = book.items;

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

    // AG-2 — a party with money on account and nothing open still has a row.
    for (const [clientId, extra] of book.byClient) {
      if (!parties.has(clientId) && extra.onAccount.gt(0)) {
        parties.set(clientId, { party: extra.party, buckets: emptyBuckets(), total: ZERO, oldest: 0, documents: [] });
      }
    }

    const asRecord = (m: Map<AgingBucketKey, Decimal>) =>
      Object.fromEntries(AGING_ORDER.map((k) => [k, m.get(k)!.toFixed(2)])) as Record<AgingBucketKey, string>;
    const rows: AgingPartyRow[] = [...parties.values()]
      .sort((a, b) => b.total.comparedTo(a.total) || a.party.name.localeCompare(b.party.name))
      .map((r) => {
        const extra = book.byClient.get(r.party.id);
        return {
          partyId: r.party.id,
          partyCode: r.party.code,
          partyName: r.party.name,
          buckets: asRecord(r.buckets),
          total: r.total.toFixed(2),
          oldestDaysLate: r.oldest,
          documents: r.documents.sort((a, b) => b.daysLate - a.daysLate || a.dueDate.localeCompare(b.dueDate)),
          onAccount: (extra?.onAccount ?? ZERO).toFixed(2),
          netBalance: r.total.minus(extra?.onAccount ?? ZERO).toFixed(2),
          ...(side === 'receivables' ? { retentionHeld: (extra?.retention ?? ZERO).toFixed(2) } : {}),
        };
      });
    const total = [...totals.values()].reduce((s, v) => s.plus(v), ZERO);

    // AG-4 — the control account on the same day. AR is a debit balance, AP a credit balance.
    const control = await this.repo.controlBalance(prisma, org, side === 'receivables' ? 'ACCOUNTS_RECEIVABLE' : 'ACCOUNTS_PAYABLE', now);
    const ledgerBalance = control
      ? side === 'receivables'
        ? new Decimal(String(control.debit ?? 0)).minus(String(control.credit ?? 0))
        : new Decimal(String(control.credit ?? 0)).minus(String(control.debit ?? 0))
      : null;
    const ledger = ledgerBalance
      ? { balance: ledgerBalance.toFixed(2), difference: total.minus(ledgerBalance).toFixed(2), agrees: total.minus(ledgerBalance).abs().lte('0.01') }
      : null;

    const onAccount = rows.reduce((s, r) => s.plus(r.onAccount ?? '0'), ZERO);
    return {
      side,
      asOf: asOfDay,
      historical,
      totals: asRecord(totals),
      total: total.toFixed(2),
      rows,
      onAccount: onAccount.toFixed(2),
      netTotal: total.minus(onAccount).toFixed(2),
      ...(side === 'receivables' ? { retentionHeld: rows.reduce((s, r) => s.plus(r.retentionHeld ?? '0'), ZERO).toFixed(2) } : {}),
      ledger,
    };
  }

  /**
   * AG-1/2/3 — the receivables on a day: each open invoice at its balance that day (today: its
   * outstanding, the Finance Home figure), each client's money on account, and retention held.
   */
  private async receivables(prisma: ReturnType<TenancyService['getClient']>, org: string, asOf: Date, historical: boolean) {
    const book = await this.repo.receivablesBook(prisma, org);
    const reversedOn = (journalId: string | null, fallback: Date | null, reversed: boolean, date: Date) =>
      reversed ? ((journalId ? book.journalDates.get(journalId) : undefined) ?? fallback ?? date) : null;
    const dec = (v: { toString(): string }) => new Decimal(v.toString());

    const invoiceMoves = new Map<string, DatedMovement[]>();
    const receiptMoves = new Map<string, DatedMovement[]>();
    const push = (map: Map<string, DatedMovement[]>, id: string, m: DatedMovement) => map.set(id, [...(map.get(id) ?? []), m]);
    for (const a of book.allocations) {
      const m = { amount: dec(a.allocatedAmount), date: a.allocationDate, reversedOn: reversedOn(a.reversalJournalEntryId, null, a.postingStatus === 'REVERSED', a.allocationDate) };
      push(invoiceMoves, a.clientInvoiceId, m);
      push(receiptMoves, a.paymentReceiptId, m);
    }
    for (const c of book.creditNotes) {
      push(invoiceMoves, c.invoiceId, { amount: dec(c.totalAmount), date: c.accountingDate, reversedOn: reversedOn(c.reversalJournalEntryId, c.reversedAt, c.postingStatus === 'REVERSED', c.accountingDate) });
    }
    for (const w of book.writeOffs) {
      push(invoiceMoves, w.invoiceId, { amount: dec(w.amount), date: w.accountingDate, reversedOn: reversedOn(w.reversalJournalEntryId, w.reversedAt, w.status === 'REVERSED', w.accountingDate) });
    }
    for (const r of book.refunds) {
      push(receiptMoves, r.receiptId, { amount: dec(r.amount), date: r.refundDate, reversedOn: reversedOn(r.reversalJournalEntryId, r.reversedAt, r.status === 'REVERSED', r.refundDate) });
    }

    const byClient = new Map<string, { party: OpenItem['party']; onAccount: Decimal; retention: Decimal }>();
    const client = (party: OpenItem['party']) => {
      const row = byClient.get(party.id) ?? { party, onAccount: ZERO, retention: ZERO };
      byClient.set(party.id, row);
      return row;
    };

    const items: OpenItem[] = [];
    for (const inv of book.invoices) {
      const doc = {
        total: dec(inv.totalAmount),
        openNow: dec(inv.outstandingAmount),
        postedOn: inv.invoiceDate,
        reversedOn: reversedOn(inv.reversalJournalEntryId, inv.reversedAt, inv.postingStatus === 'REVERSED', inv.invoiceDate),
        movements: invoiceMoves.get(inv.id) ?? [],
      };
      if (!existedOn(doc, asOf)) continue;
      const row = client(inv.client);
      row.retention = row.retention.plus(dec(inv.retentionAmount)).minus(dec(inv.retentionReleasedAmount));
      const open = historical ? balanceOn(doc, asOf)! : inv.postingStatus === 'REVERSED' ? ZERO : doc.openNow;
      if (!open.gt(0)) continue;
      items.push({
        party: inv.client,
        outstanding: open,
        // An invoice without a due date is due on its date (the Finance Home rule).
        document: { id: inv.id, number: inv.invoiceNumber, date: day(inv.invoiceDate), due: inv.dueDate ?? inv.invoiceDate, opening: inv.postingStatus === 'OPENING_BALANCE' },
      });
    }
    for (const r of book.receipts) {
      const doc = {
        total: dec(r.totalAmount),
        openNow: dec(r.unallocatedAmount),
        postedOn: r.accountingDate,
        reversedOn: reversedOn(r.reversalJournalEntryId, r.reversedAt, r.postingStatus === 'REVERSED', r.accountingDate),
        movements: receiptMoves.get(r.id) ?? [],
      };
      if (!existedOn(doc, asOf)) continue;
      const held = historical ? balanceOn(doc, asOf)! : r.postingStatus === 'REVERSED' ? ZERO : doc.openNow;
      if (held.gt(0)) client(r.client).onAccount = client(r.client).onAccount.plus(held);
    }
    for (const row of byClient.values()) row.retention = Decimal.max(row.retention, ZERO);
    return { items, byClient };
  }

  /**
   * AA — the payables on a day, built like the receivables (AG-1): each bill at what was still owed
   * on it at the end of that day, from the payments applied, debit notes and buyer cash applied and
   * their reversals; and each supplier's money paid ahead (payments not yet applied to a bill, less
   * what they paid back). Today a bill also counts what unposted payments hold on it (AP-1) — the
   * ledger has not moved for those yet, so neither does the aging.
   */
  private async payables(prisma: ReturnType<TenancyService['getClient']>, org: string, asOf: Date, historical: boolean) {
    const book = await this.repo.payablesBook(prisma, org);
    const journalDay = (id: string | null) => (id ? book.journalDates.get(id) : undefined);
    const reversedOn = (journalId: string | null, fallback: Date | null, reversed: boolean, date: Date) =>
      reversed ? (journalDay(journalId) ?? fallback ?? date) : null;
    const dec = (v: { toString(): string }) => new Decimal(v.toString());
    const holds = await pendingPaymentHolds(prisma as never, org, book.bills.map((b) => b.id));

    const billMoves = new Map<string, DatedMovement[]>();
    const paymentMoves = new Map<string, DatedMovement[]>();
    const push = (map: Map<string, DatedMovement[]>, id: string, m: DatedMovement) => map.set(id, [...(map.get(id) ?? []), m]);
    for (const a of book.allocations) {
      // Dated as its journal: the payment's own for what it paid when raised, its own for advance applied later.
      const date = journalDay(a.journalEntryId) ?? a.allocationDate;
      const m = { amount: dec(a.allocatedAmount), date, reversedOn: reversedOn(a.reversalJournalEntryId, null, a.postingStatus === 'REVERSED', date) };
      push(billMoves, a.supplierBillId, m);
      push(paymentMoves, a.supplierPaymentId, m);
    }
    for (const n of book.debitNotes) {
      push(billMoves, n.supplierBillId, { amount: dec(n.amount), date: n.accountingDate, reversedOn: reversedOn(n.reversalJournalEntryId, n.reversedAt, n.status === 'REVERSED', n.accountingDate) });
    }
    for (const c of book.buyerCash) {
      const date = journalDay(c.journalEntryId) ?? c.allocationDate ?? asOf;
      push(billMoves, c.supplierBillId, { amount: dec(c.allocatedAmount), date, reversedOn: reversedOn(c.reversalJournalEntryId, c.reversedAt, c.postingStatus === 'REVERSED', date) });
    }
    for (const r of book.refunds) {
      push(paymentMoves, r.supplierPaymentId, { amount: dec(r.amount), date: r.refundDate, reversedOn: reversedOn(r.reversalJournalEntryId, r.reversedAt, r.status === 'REVERSED', r.refundDate) });
    }

    const byClient = new Map<string, { party: OpenItem['party']; onAccount: Decimal; retention: Decimal }>();
    const items: OpenItem[] = [];
    for (const bill of book.bills) {
      const doc = {
        total: dec(bill.totalAmount),
        openNow: dec(bill.outstandingAmount).plus(holds.get(bill.id) ?? ZERO),
        postedOn: bill.billDate,
        reversedOn: reversedOn(bill.reversalJournalEntryId, bill.reversedAt, bill.postingStatus === 'REVERSED', bill.billDate),
        movements: billMoves.get(bill.id) ?? [],
      };
      if (!existedOn(doc, asOf)) continue;
      const open = historical ? balanceOn(doc, asOf)! : bill.postingStatus === 'REVERSED' ? ZERO : doc.openNow;
      if (!open.gt(0)) continue;
      items.push({
        party: bill.supplier,
        outstanding: open,
        document: { id: bill.id, number: bill.billNumber ?? bill.supplierInvoiceNumber, date: day(bill.billDate), due: bill.dueDate, opening: bill.postingStatus === 'OPENING_BALANCE' },
      });
    }
    for (const p of book.payments) {
      const doc = {
        total: dec(p.totalAmount),
        openNow: dec(p.unallocatedAmount),
        postedOn: p.accountingDate,
        reversedOn: reversedOn(p.reversalJournalEntryId, p.reversedAt, p.postingStatus === 'REVERSED', p.accountingDate),
        movements: paymentMoves.get(p.id) ?? [],
      };
      if (!existedOn(doc, asOf)) continue;
      const held = historical ? balanceOn(doc, asOf)! : p.postingStatus === 'REVERSED' ? ZERO : doc.openNow;
      if (!held.gt(0)) continue;
      const row = byClient.get(p.supplier.id) ?? { party: p.supplier, onAccount: ZERO, retention: ZERO };
      row.onAccount = row.onAccount.plus(held);
      byClient.set(p.supplier.id, row);
    }
    return { items, byClient };
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
