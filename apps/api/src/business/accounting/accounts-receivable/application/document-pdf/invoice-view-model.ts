import { Decimal } from '@prisma/client/runtime/library';

import {
  brandView,
  countryName,
  footerColumns,
  formatAmount,
  formatDate,
  formatMoney,
  splitLines,
  type BrandView,
  type FooterColumn,
  type FooterContactsInput,
  type KeyValue,
  type OrgIdentityInput,
} from './pdf-kit.js';

/**
 * The client invoice PDF's data — everything the document prints, already resolved from the
 * invoice, its frozen snapshot and its source records — and the pure mapping from that data to
 * what each section of the page shows ({@link buildInvoiceViewModel}). The renderer
 * (invoice-document.service.ts) only lays the view model out; every decision about what is shown,
 * omitted, masked or labelled lives here, where it is unit-tested.
 */

/** Stamped into the PDF metadata so a stored document says which layout produced it. */
export const INVOICE_TEMPLATE_VERSION = 'invoice-template-v3-minimal';

export interface InvoiceDocumentLine {
  /** Bold first line, e.g. "Stage 2 of 4 – Substructure complete" or "VO-03 Additional shop fronts". */
  title: string;
  /** Muted second line, e.g. "30% of the contract value of USD 412,500.00"; null for none. */
  detail: string | null;
  /** Decimal strings. */
  quantity: string;
  unitPrice: string;
  amount: string;
}

/** One row of the "Bank Account Details" table, as typed in the invoice settings. */
export interface InvoicePaymentAccount {
  bankName: string;
  accountNumber: string;
}

export interface InvoiceSignatory {
  name: string;
  title: string | null;
}

export interface InvoiceDocumentInput {
  invoiceNumber: string | null;
  invoiceDate: Date;
  /** Null for separate-charge draft invoices where payment terms have not been set yet. */
  dueDate: Date | null;
  paymentTerms: string | null;
  currencyCode: string;
  /** Decimal strings. */
  subtotal: string;
  vatAmount: string;
  totalAmount: string;
  /**
   * ADR-041 — the rate (percent) the invoice was raised at, for the "Sales Tax 5%" label. Derived
   * from the amounts only when absent: tax is rounded to cents, so a derived rate can read 5.0105%.
   */
  taxRatePercent?: string | null;
  client: {
    name: string;
    address: string | null;
    city: string | null;
    countryCode: string | null;
    taxNumber: string | null;
  };
  project: { code: string; name: string; location: string | null } | null;
  lines: InvoiceDocumentLine[];
  /** The organisation's "Bank Account Details" rows; printed only with `showBankDetails`. */
  paymentAccounts: InvoicePaymentAccount[];
  /** The organisation's invoice notes (one per line); null → the default notes. Printed only with `showNotes`. */
  notes: string | null;
  showBankDetails: boolean;
  showNotes: boolean;
  signatory: InvoiceSignatory | null;
  /** The footer contact strip; null → the organisation's legal address only. */
  footer: FooterContactsInput | null;
  org: OrgIdentityInput;
}

export interface InvoiceLineView {
  index: string;
  title: string;
  detail: string | null;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoiceViewModel {
  brand: BrandView;
  title: 'INVOICE';
  meta: KeyValue[];
  billTo: { label: string; name: string; lines: string[] };
  project: { label: string; name: string; lines: string[] } | null;
  columns: { index: string; description: string; quantity: string; unitPrice: string; amount: string };
  lines: InvoiceLineView[];
  totals: KeyValue[];
  total: KeyValue;
  /** Null unless the settings turn the section on and there is a complete row. */
  payment: {
    title: string;
    columns: { bank: string; accountNumber: string };
    rows: Array<{ bank: string; accountNumber: string }>;
    reference: KeyValue;
  } | null;
  /** Empty unless the settings turn the section on. */
  notes: string[];
  signature: { name: string | null; title: string | null; company: string; date: string };
  footer: FooterColumn[];
}

export function buildInvoiceViewModel(input: InvoiceDocumentInput): InvoiceViewModel {
  const currency = input.currencyCode;
  const money = (value: string) => formatMoney(value, currency);
  const terms = paymentTermsLabel(input.paymentTerms, input.invoiceDate, input.dueDate);

  const meta: KeyValue[] = [
    { label: 'Invoice No.', value: input.invoiceNumber ?? 'DRAFT' },
    { label: 'Invoice Date', value: formatDate(input.invoiceDate) },
  ];
  if (input.dueDate) meta.push({ label: 'Due Date', value: formatDate(input.dueDate) });
  if (terms) meta.push({ label: 'Payment Terms', value: terms.label });

  const lines: InvoiceLineView[] = (input.lines.length > 0 ? input.lines : [fallbackLine(input)]).map((line, i) => ({
    index: String(i + 1),
    title: line.title,
    detail: line.detail?.trim() || null,
    quantity: formatQuantity(line.quantity),
    unitPrice: formatAmount(line.unitPrice),
    amount: formatAmount(line.amount),
  }));

  const signatoryName = input.signatory?.name?.trim() || null;
  return {
    brand: brandView(input.org),
    title: 'INVOICE',
    meta,
    billTo: {
      label: 'Bill To',
      name: input.client.name,
      lines: [...clientAddressLines(input.client), `Tax Reg. ${input.client.taxNumber?.trim() || '—'}`],
    },
    project: input.project ? projectColumn(input.project) : null,
    columns: {
      index: '#',
      description: 'Description',
      quantity: 'Qty',
      unitPrice: `Unit Price (${currency})`,
      amount: `Amount (${currency})`,
    },
    lines,
    totals: [
      { label: 'Subtotal', value: money(input.subtotal) },
      { label: salesTaxLabel(input), value: money(input.vatAmount) },
    ],
    total: { label: 'Total Due', value: money(input.totalAmount) },
    payment: input.showBankDetails ? paymentCard(input) : null,
    notes: input.showNotes ? invoiceNotes(input.notes, terms?.days ?? null) : [],
    signature: {
      name: signatoryName,
      title: signatoryName ? input.signatory?.title?.trim() || null : null,
      company: input.org.name,
      date: formatDate(input.invoiceDate),
    },
    footer: footerColumns(input.footer, input.org.legalAddress),
  };
}

/** "ACCO-DHL-26-0012" bold, then the name and location on one line ("ABC, Dharkeynley, KM4, Mogadishu"). */
function projectColumn(project: NonNullable<InvoiceDocumentInput['project']>): NonNullable<InvoiceViewModel['project']> {
  const where = [project.name?.trim(), project.location?.trim()].filter((part): part is string => Boolean(part));
  return { label: 'Project', name: project.code, lines: where.length > 0 ? [where.join(', ')] : [] };
}

/** "Sales Tax (5%)" from the invoice's own rate (ADR-041), else derived from the amounts. */
export function salesTaxLabel(input: Pick<InvoiceDocumentInput, 'taxRatePercent' | 'subtotal' | 'vatAmount'>): string {
  const rate =
    input.taxRatePercent !== null && input.taxRatePercent !== undefined && input.taxRatePercent !== ''
      ? trimRate(Number(input.taxRatePercent))
      : derivedRate(input.subtotal, input.vatAmount);
  return rate !== null ? `Sales Tax (${rate}%)` : 'Sales Tax';
}

function trimRate(rate: number): string | null {
  if (!Number.isFinite(rate)) return null;
  return String(Number(rate.toFixed(2)));
}

function derivedRate(subtotal: string, vatAmount: string): string | null {
  const base = Number(subtotal);
  const tax = Number(vatAmount);
  if (!Number.isFinite(base) || base <= 0 || !Number.isFinite(tax)) return null;
  const pct = (tax / base) * 100;
  return Number.isInteger(pct) ? String(pct) : pct.toFixed(1);
}

/**
 * The terms as printed ("Net 30 days") and the day count the default note uses. A bare number is
 * read as days; "Net 30" gains its unit; other free text prints as typed. With no terms text the
 * count comes from the due date, and with neither there are no terms to print.
 */
export function paymentTermsLabel(
  terms: string | null,
  invoiceDate: Date,
  dueDate: Date | null,
): { label: string; days: number | null } | null {
  const text = terms?.trim() ?? '';
  if (text) {
    if (/^\d+$/.test(text)) return { label: `Net ${Number(text)} days`, days: Number(text) };
    const net = /^net\s*(\d+)$/i.exec(text);
    if (net) return { label: `Net ${Number(net[1])} days`, days: Number(net[1]) };
    const anyDays = /(\d+)\s*days?/i.exec(text);
    return { label: text, days: anyDays ? Number(anyDays[1]) : null };
  }
  if (dueDate) {
    const days = Math.round((dueDate.getTime() - invoiceDate.getTime()) / 86_400_000);
    if (days > 0) return { label: `Net ${days} days`, days };
  }
  return null;
}

/** The organisation's own notes (one per non-empty line), else the standard set. */
export function invoiceNotes(notes: string | null, termDays: number | null): string[] {
  const own = splitLines(notes);
  if (own.length > 0) return own;
  return defaultInvoiceNotes(termDays);
}

export function defaultInvoiceNotes(termDays: number | null): string[] {
  const notes = [
    'Please quote the invoice number in your payment.',
    'This invoice is issued in accordance with the project contract.',
  ];
  if (termDays !== null && termDays > 0) {
    notes.push(`Payment is due within ${termDays} days from the invoice date.`);
  }
  return notes;
}

/**
 * The "Bank Account Details" table: one row per typed bank account, printed in full (a client
 * cannot pay into a masked number), then the reference to quote. No complete row → no card.
 */
function paymentCard(input: InvoiceDocumentInput): InvoiceViewModel['payment'] {
  const rows = input.paymentAccounts
    .map((account) => ({ bank: account.bankName.trim(), accountNumber: account.accountNumber.trim() }))
    .filter((row) => row.bank && row.accountNumber);
  if (rows.length === 0) return null;
  return {
    title: 'Bank Account Details',
    columns: { bank: 'Bank', accountNumber: 'Account number' },
    rows,
    reference: { label: 'Reference', value: input.invoiceNumber ?? 'Quote the invoice number' },
  };
}

/** Street lines, then "City, Country" — the city is skipped when the address already names it. */
export function clientAddressLines(client: InvoiceDocumentInput['client']): string[] {
  const lines = splitLines(client.address);
  const joined = lines.join(' ').toLowerCase();
  const city = client.city?.trim() || null;
  const country = countryName(client.countryCode);
  const locality = [
    city && !joined.includes(city.toLowerCase()) ? city : null,
    country && !joined.includes(country.toLowerCase()) ? country : null,
  ].filter((part): part is string => part !== null);
  if (locality.length > 0) lines.push(locality.join(', '));
  return lines;
}

/** "1" for whole quantities, else up to 3dp. */
function formatQuantity(value: string): string {
  const qty = Number(value);
  if (!Number.isFinite(qty)) return value;
  return Number.isInteger(qty) ? String(qty) : String(Number(qty.toFixed(3)));
}

function fallbackLine(input: InvoiceDocumentInput): InvoiceDocumentLine {
  return {
    title: `Invoice ${input.invoiceNumber ?? ''}`.trim(),
    detail: null,
    quantity: '1',
    unitPrice: input.subtotal,
    amount: input.subtotal,
  };
}

// ─── Lines from the invoice's source ──────────────────────────────────────────────

/** What the invoice was raised from, as read at render time (see invoice-document-data.ts). */
export interface InvoiceLineSource {
  /** The invoice's frozen description (installment name, "Interim Certificate 3", "VO-03 — …"). */
  description: string;
  subtotal: string;
  currencyCode: string;
  contractNumber: string | null;
  /** A payment-schedule stage invoice. */
  installment: {
    name: string;
    /** 1-based position in the contract's schedule, and the number of stages. */
    position: number;
    count: number;
    /** Fraction of the schedule base, e.g. "0.3". */
    percentage: string;
    /** The value the schedule is a percentage of (base contract value, else contract value). */
    scheduleBase: string;
  } | null;
  /** Variation-billing rows that point at this invoice. */
  variations: Array<{
    reference: string;
    title: string;
    clientApproved: boolean;
    treatment: 'INVOICE' | 'STAGE_REDUCTION' | 'CREDIT_NOTE';
    /** Decimal string, the allocation's amount (a magnitude). */
    amount: string;
  }>;
}

/** Amounts as Decimal, rounded to cents like the invoice service — never binary floats. */
const money2 = (value: string | Decimal) => new Decimal(value).toDecimalPlaces(2);

/**
 * The invoice's line table from what it was raised for. Never invents a figure: a breakdown is
 * used only when its lines add up to the invoice subtotal exactly; otherwise the invoice prints as
 * one line for its subtotal, with only the sub-description facts that still hold.
 */
export function buildInvoiceLines(source: InvoiceLineSource): InvoiceDocumentLine[] {
  const single = (title: string, detail: string | null): InvoiceDocumentLine[] => [
    { title, detail, quantity: '1', unitPrice: source.subtotal, amount: source.subtotal },
  ];
  const subtotal = money2(source.subtotal);

  if (source.installment) {
    const stage = source.installment;
    const percentage = new Decimal(stage.percentage);
    const pctLabel = percentage.mul(100).toDecimalPlaces(2).toString();
    // Same rule as ClientInvoiceService.generateFromInstallment: pct × base, rounded to cents.
    const stageAmount = new Decimal(stage.scheduleBase).mul(percentage).toDecimalPlaces(2);
    const title =
      stage.count > 1 ? `Stage ${stage.position} of ${stage.count} – ${stage.name}` : stage.name;
    const detail = `${pctLabel}% of the contract value of ${formatMoney(stage.scheduleBase, source.currencyCode)}`;

    const omissions = source.variations.filter((v) => v.treatment === 'STAGE_REDUCTION');
    const omissionAmounts = omissions.map((v) => money2(v.amount).abs().neg());
    const total = omissionAmounts.reduce((sum, value) => sum.plus(value), stageAmount);
    if (total.equals(subtotal)) {
      return [
        { title, detail, quantity: '1', unitPrice: stageAmount.toFixed(2), amount: stageAmount.toFixed(2) },
        ...omissions.map((v, i) => ({
          title: `${v.reference} ${v.title}`.trim(),
          detail: 'Omission variation deducted from this stage',
          quantity: '1',
          unitPrice: omissionAmounts[i].toFixed(2),
          amount: omissionAmounts[i].toFixed(2),
        })),
      ];
    }
    // The stage figure no longer reconciles to the subtotal (e.g. the schedule base changed):
    // print the stage for its invoiced subtotal and drop the percentage claim.
    return single(title, stageAmount.equals(subtotal) ? detail : null);
  }

  const billedVariation = source.variations.find((v) => v.treatment === 'INVOICE');
  if (billedVariation) {
    const detail = billedVariation.clientApproved
      ? 'Client-approved variation'
      : source.contractNumber
        ? `Variation to contract ${source.contractNumber}`
        : 'Contract variation';
    return single(`${billedVariation.reference} ${billedVariation.title}`.trim(), detail);
  }

  return single(source.description, source.contractNumber ? `Contract ${source.contractNumber}` : null);
}
