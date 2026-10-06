import { Injectable } from '@nestjs/common';
import { Document, Page, Text, View, renderToBuffer } from '@react-pdf/renderer';

import {
  brandView,
  buildKitStyles,
  divider,
  documentFooter,
  documentHeader,
  footerColumns,
  formatDate,
  formatMoney,
  h,
  infoColumns,
  pageNumbers,
  splitLines,
  topBar,
  totalsBlock,
  type FooterContactsInput,
  type KeyValue,
} from './document-pdf/pdf-kit.js';

/**
 * The branded payment-receipt PDF (WhatsApp V1 step 3) — the receipt counterpart of
 * {@link InvoiceDocumentService}, in the same minimal layout (brand bar, header, two-column info
 * band, ruled table, total box, footer contact strip) from the shared kit (document-pdf/pdf-kit.ts).
 * See `PaymentReceiptDocumentService` for when it runs: lazily, on first request for a POSTED
 * receipt, then frozen.
 */

export interface ReceiptDocumentAllocation {
  /** The invoice's number, or a fallback label for an unnumbered one. */
  invoiceNumber: string;
  /** Decimal string, 2dp. */
  amount: string;
}

export interface ReceiptDocumentInput {
  receiptNumber: string;
  receiptDate: Date;
  currencyCode: string;
  /** Decimal strings, 2dp. */
  totalAmount: string;
  /** What the receipt was applied to when it was posted. */
  allocations: ReceiptDocumentAllocation[];
  /** The part of the payment not applied to an invoice at posting (later allocations are not shown). */
  unallocatedAmount: string;
  paymentMethod: string | null;
  /** The receiving bank account, e.g. 'Premier Bank — ACCO Operating'. */
  bankAccountLabel: string | null;
  reference: string | null;
  bankReference: string | null;
  clientName: string;
  clientAddress: string | null;
  org: {
    name: string;
    legalAddress: string | null;
    taxRegistrationNumber: string | null;
    brandColorHex: string | null;
    template: 'STANDARD' | 'COMPACT';
    logo: { buffer: Buffer; mimeType: string } | null;
    /** From the invoice settings; optional. */
    tagline?: string | null;
  };
  /** The footer contact strip (invoice settings); null → the legal address only. */
  footer?: FooterContactsInput | null;
}

export const RECEIPT_TEMPLATE_VERSION = 'receipt-template-v3-minimal';

@Injectable()
export class ReceiptDocumentService {
  async render(input: ReceiptDocumentInput): Promise<Buffer> {
    return renderToBuffer(ReceiptDocument({ input }) as never);
  }
}

/** Exported for the unit test, which walks the element tree for its text. */
export function ReceiptDocument({ input }: { input: ReceiptDocumentInput }) {
  const brand = brandView(input.org);
  const s = buildKitStyles(brand.palette, brand.compact);
  const money = (value: string) => formatMoney(value, input.currencyCode);
  const hasUnallocated = Number(input.unallocatedAmount) > 0;

  const meta: KeyValue[] = [
    { label: 'Receipt No.', value: input.receiptNumber },
    { label: 'Date Received', value: formatDate(input.receiptDate) },
  ];
  const facts: string[] = [
    input.bankAccountLabel ? `Received into ${input.bankAccountLabel}` : null,
    input.reference ? `Reference: ${input.reference}` : null,
    input.bankReference ? `Bank reference: ${input.bankReference}` : null,
  ].filter((line): line is string => line !== null);

  const rows = [
    ...input.allocations.map((allocation) => ({
      description: `Invoice ${allocation.invoiceNumber}`,
      amount: money(allocation.amount),
    })),
    ...(hasUnallocated || input.allocations.length === 0
      ? [{ description: 'Unallocated when the payment was recorded', amount: money(input.unallocatedAmount) }]
      : []),
  ];

  return h(
    Document,
    {
      title: `Receipt ${input.receiptNumber}`,
      author: input.org.name,
      creator: RECEIPT_TEMPLATE_VERSION,
      producer: RECEIPT_TEMPLATE_VERSION,
    },
    h(
      Page,
      { size: 'A4', style: s.page },
      topBar(s),
      documentHeader(s, brand, 'RECEIPT', meta),
      divider(s),
      infoColumns(
        s,
        { label: 'Received From', name: input.clientName, lines: splitLines(input.clientAddress) },
        paymentColumn(input.paymentMethod, facts),
      ),

      // What the payment was applied to.
      h(
        View,
        { style: s.table },
        h(
          View,
          { style: s.thRow, fixed: true },
          h(Text, { style: [s.cell, s.th, { flex: 1 }] }, 'Applied To'),
          h(Text, { style: [s.cell, s.th, s.ruledCell, { width: 150, textAlign: 'right' }] }, 'Amount Applied'),
        ),
        ...rows.map((row, i) =>
          h(
            View,
            { style: i === rows.length - 1 ? s.trLast : s.tr, wrap: false, key: `a${i}` },
            h(Text, { style: [s.cell, s.td, { flex: 1 }] }, row.description),
            h(Text, { style: [s.cell, s.td, s.ruledCell, { width: 150, textAlign: 'right' }] }, row.amount),
          ),
        ),
      ),

      totalsBlock(s, [], { label: 'Total Received', value: money(input.totalAmount) }),
      documentFooter(s, brand, footerColumns(input.footer, input.org.legalAddress)),
      pageNumbers(s),
    ),
  );
}

/**
 * The "Payment" column: the method in bold over the receipt's facts. Without a method the first
 * fact leads (never "Payment" under the "Payment" label); with nothing to say there is no column.
 */
function paymentColumn(method: string | null, facts: string[]) {
  if (method) return { label: 'Payment', name: humanise(method), lines: facts };
  if (facts.length === 0) return null;
  return { label: 'Payment', name: facts[0], lines: facts.slice(1) };
}

/** 'BANK_TRANSFER' → 'Bank transfer'; free text is shown as typed. */
function humanise(value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return value;
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
