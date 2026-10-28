import { BadRequestException, Injectable } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import type { RequestIdentity, VatReport, VatReportLine } from '@erp/types';

import { TenancyService } from '../../../../platform/tenancy/tenancy.service.js';
import { VatReportRepository } from '../infrastructure/vat-report.repository.js';

const ZERO = new Decimal(0);
const day = (d: Date) => d.toISOString().slice(0, 10);
const dec = (v: { toString(): string } | null | undefined) => new Decimal(v?.toString() ?? '0');
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Step 6 — the VAT report for a period.
 *
 * Output VAT is read from the ledger, not from the documents: every posted line on an output VAT
 * account dated in the period, each traced to the invoice or credit note that wrote it. So the
 * report's total is, by construction, what the VAT account moved by — a reversal appears as its
 * own negative line in the period it was reversed, and a journal posted straight to the account
 * appears as an adjustment rather than vanishing. Input VAT on supplier bills is non-recoverable
 * (ACC-TAX-001: the gross goes to expense), so it is listed for information and never netted off.
 */
const billOf = (p: { sourceDocumentId: string | null; reversalOf: { sourceDocumentId: string | null } | null }) =>
  p.reversalOf?.sourceDocumentId ?? p.sourceDocumentId;

@Injectable()
export class VatReportService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly repo: VatReportRepository,
  ) {}

  async report(identity: RequestIdentity, fromText: string, toText: string): Promise<VatReport> {
    if (!DATE.test(fromText) || !DATE.test(toText) || fromText > toText) {
      throw new BadRequestException({ errorCode: 'PERIOD_INVALID', message: 'Give from and to as YYYY-MM-DD, with from on or before to.' });
    }
    const from = new Date(`${fromText}T00:00:00.000Z`);
    const to = new Date(`${toText}T00:00:00.000Z`);
    const prisma = this.tenancy.getClient();
    const org = identity.activeOrganizationId;

    // With no output VAT account, `in: []` matches nothing: the report is simply empty.
    const accountIds = await this.repo.outputVatAccountIds(prisma, org);
    const [raw, balance, billPostings] = await Promise.all([
      this.repo.vatLines(prisma, org, accountIds, from, to),
      this.repo.balanceTo(prisma, org, accountIds, to),
      this.repo.billPostings(prisma, org, from, to),
    ]);

    // The document a line belongs to: its own, or for a reversal, the reversed journal's.
    const sourceOf = (l: (typeof raw)[number]) => ({
      type: l.entry.reversalOf?.sourceDocumentType ?? l.entry.sourceDocumentType,
      id: l.entry.reversalOf?.sourceDocumentId ?? l.entry.sourceDocumentId,
    });
    const idsOf = (type: string) => [...new Set(raw.map(sourceOf).filter((s) => s.type === type && s.id).map((s) => s.id!))];
    const [invoices, creditNotes, bills] = await Promise.all([
      this.repo.invoices(prisma, org, idsOf('CLIENT_INVOICE')),
      this.repo.creditNotes(prisma, org, idsOf('CREDIT_NOTE')),
      this.repo.bills(prisma, org, [...new Set(billPostings.map(billOf).filter((id): id is string => Boolean(id)))]),
    ]);
    const invoiceById = new Map(invoices.map((i) => [i.id, i]));
    const creditById = new Map(creditNotes.map((c) => [c.id, c]));

    const lines: VatReportLine[] = raw.map((l) => {
      const vat = dec(l.creditAmount).minus(dec(l.debitAmount));
      const reversal = Boolean(l.entry.reversalOfJournalEntryId);
      const sign = reversal ? -1 : 1;
      const base = {
        journalEntryId: l.entry.id,
        journalNumber: l.entry.journalNumber,
        accountingDate: day(l.entry.accountingDate),
        vat: vat.toFixed(2),
        reversal,
      };
      const source = sourceOf(l);
      const invoice = source.type === 'CLIENT_INVOICE' ? invoiceById.get(source.id ?? '') : undefined;
      if (invoice) {
        return {
          ...base, kind: 'INVOICE' as const, documentId: invoice.id, documentNumber: invoice.invoiceNumber, partyName: invoice.client.name,
          taxableAmount: dec(invoice.subtotal).times(sign).toFixed(2), rate: dec(invoice.taxRate).toFixed(4),
        };
      }
      const credit = source.type === 'CREDIT_NOTE' ? creditById.get(source.id ?? '') : undefined;
      if (credit) {
        return {
          ...base, kind: 'CREDIT_NOTE' as const, documentId: credit.id, documentNumber: credit.creditNoteNumber, partyName: credit.invoice.client.name,
          taxableAmount: dec(credit.netAmount).times(-sign).toFixed(2), rate: dec(credit.invoice.taxRate).toFixed(4),
        };
      }
      return { ...base, kind: 'ADJUSTMENT' as const, documentId: null, documentNumber: null, partyName: null, taxableAmount: null, rate: null };
    });

    const sum = (rows: VatReportLine[], pick: (r: VatReportLine) => string | null) => rows.reduce((s, r) => s.plus(pick(r) ?? '0'), ZERO);
    const ofKind = (kind: VatReportLine['kind']) => lines.filter((l) => l.kind === kind);
    const byRate = new Map<string, { taxable: Decimal; vat: Decimal }>();
    for (const l of lines) {
      if (l.rate === null) continue;
      const r = byRate.get(l.rate) ?? { taxable: ZERO, vat: ZERO };
      r.taxable = r.taxable.plus(l.taxableAmount ?? '0');
      r.vat = r.vat.plus(l.vat);
      byRate.set(l.rate, r);
    }

    // Input VAT, for information: each bill posting in the period counts once, a reversal backs it out.
    const billById = new Map(bills.map((b) => [b.id, b]));
    let inputCount = 0;
    let inputTaxable = ZERO;
    let inputVat = ZERO;
    for (const p of billPostings) {
      const bill = billById.get(billOf(p) ?? '');
      if (!bill) continue;
      const sign = p.reversalOfJournalEntryId ? -1 : 1;
      inputCount += sign;
      inputTaxable = inputTaxable.plus(dec(bill.subtotal).times(sign));
      inputVat = inputVat.plus(dec(bill.vatAmount).times(sign));
    }

    const invoiceLines = ofKind('INVOICE');
    const creditLines = ofKind('CREDIT_NOTE');
    const adjustmentLines = ofKind('ADJUSTMENT');
    return {
      from: fromText,
      to: toText,
      output: {
        byRate: [...byRate.entries()]
          .sort(([a], [b]) => Number(b) - Number(a))
          .map(([rate, r]) => ({ rate, taxable: r.taxable.toFixed(2), vat: r.vat.toFixed(2) })),
        invoices: { count: invoiceLines.length, taxable: sum(invoiceLines, (l) => l.taxableAmount).toFixed(2), vat: sum(invoiceLines, (l) => l.vat).toFixed(2) },
        creditNotes: { count: creditLines.length, taxable: sum(creditLines, (l) => l.taxableAmount).toFixed(2), vat: sum(creditLines, (l) => l.vat).toFixed(2) },
        adjustments: { count: adjustmentLines.length, vat: sum(adjustmentLines, (l) => l.vat).toFixed(2) },
        total: sum(lines, (l) => l.vat).toFixed(2),
        lines,
      },
      input: { count: inputCount, taxable: inputTaxable.toFixed(2), vat: inputVat.toFixed(2) },
      closingBalance: dec(balance.credit).minus(dec(balance.debit)).toFixed(2),
    };
  }
}
