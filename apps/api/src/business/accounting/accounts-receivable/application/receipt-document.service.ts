import { Injectable } from '@nestjs/common';
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from '@react-pdf/renderer';

import {
  amountPanel,
  brandView,
  buildKitStyles,
  divider,
  documentFooter,
  documentHeader,
  pageNumbers,
  formatDate,
  formatMoney,
  h,
  sectionLabel,
  splitLines,
  type KeyValue,
  type Palette,
} from './document-pdf/pdf-kit.js';

/**
 * The branded payment-receipt PDF (WhatsApp V1 step 3) — the receipt counterpart of
 * {@link InvoiceDocumentService}. The header, footer, palette and cards come from the shared
 * document kit (document-pdf/pdf-kit.ts), so the two documents always wear the same brand. See
 * `PaymentReceiptDocumentService` for when it runs: lazily, on first request for a POSTED receipt,
 * then frozen.
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
    footerNote: string | null;
    template: 'STANDARD' | 'COMPACT';
    logo: { buffer: Buffer; mimeType: string } | null;
  };
}

export const RECEIPT_TEMPLATE_VERSION = 'receipt-template-v2';

@Injectable()
export class ReceiptDocumentService {
  async render(input: ReceiptDocumentInput): Promise<Buffer> {
    return renderToBuffer(ReceiptDocument({ input }) as never);
  }
}

/** Exported for the unit test, which walks the element tree for its text. */
export function ReceiptDocument({ input }: { input: ReceiptDocumentInput }) {
  const brand = brandView(input.org);
  const kit = buildKitStyles(brand.palette, brand.compact);
  const s = buildReceiptStyles(brand.palette, brand.compact);
  const money = (value: string) => formatMoney(value, input.currencyCode);
  const hasUnallocated = Number(input.unallocatedAmount) > 0;

  const meta: KeyValue[] = [
    { label: 'Receipt No.', value: input.receiptNumber },
    { label: 'Date Received', value: formatDate(input.receiptDate) },
  ];
  const facts: KeyValue[] = [
    input.paymentMethod ? { label: 'Payment method', value: humanise(input.paymentMethod) } : null,
    input.bankAccountLabel ? { label: 'Received into', value: input.bankAccountLabel } : null,
    input.reference ? { label: 'Reference', value: input.reference } : null,
    input.bankReference ? { label: 'Bank reference', value: input.bankReference } : null,
  ].filter((row): row is KeyValue => row !== null);

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
      { size: 'A4', style: kit.page },
      documentHeader(kit, brand, 'RECEIPT', meta),
      divider(kit),

      // Received from · payment facts · amount received.
      h(
        View,
        { style: s.partiesRow },
        h(
          View,
          { style: s.partyColumn },
          sectionLabel(kit, 'RECEIVED FROM'),
          h(Text, { style: kit.strong }, input.clientName),
          ...splitLines(input.clientAddress).map((line, i) => h(Text, { style: kit.small, key: `ca${i}` }, line)),
        ),
        h(
          View,
          { style: s.partyColumn },
          facts.length > 0 ? sectionLabel(kit, 'PAYMENT') : null,
          ...facts.map((row, i) =>
            h(
              View,
              { style: s.factRow, key: `f${i}` },
              h(Text, { style: s.factLabel }, row.label),
              h(Text, { style: s.factValue }, row.value),
            ),
          ),
        ),
        amountPanel(kit, 'AMOUNT RECEIVED', money(input.totalAmount), s.amountColumn),
      ),

      // What the payment was applied to.
      h(
        View,
        { style: s.table },
        h(
          View,
          { style: s.tableHeader, fixed: true },
          h(Text, { style: [s.th, s.colDescription] }, 'APPLIED TO'),
          h(Text, { style: [s.th, s.colAmount] }, 'AMOUNT APPLIED'),
        ),
        ...rows.map((row, i) =>
          h(
            View,
            { style: s.tr, wrap: false, key: `a${i}` },
            h(Text, { style: [s.td, s.colDescription] }, row.description),
            h(Text, { style: [s.td, s.colAmount] }, row.amount),
          ),
        ),
      ),

      h(
        View,
        { style: s.totalRowStrong, wrap: false },
        h(Text, { style: s.totalStrong }, 'Total received'),
        h(Text, { style: s.totalStrong }, money(input.totalAmount)),
      ),

      !brand.compact && input.org.footerNote ? h(Text, { style: s.footerNote }, input.org.footerNote) : null,
      documentFooter(kit, brand, 'Thank you for your payment.'),
      pageNumbers(kit),
    ),
  );
}

/** 'BANK_TRANSFER' → 'Bank transfer'; free text is shown as typed. */
function humanise(value: string): string {
  if (!/^[A-Z][A-Z0-9_]*$/.test(value)) return value;
  const words = value.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function buildReceiptStyles(p: Palette, compact: boolean) {
  return StyleSheet.create({
    partiesRow: { flexDirection: 'row', marginBottom: compact ? 16 : 22 },
    partyColumn: { width: '33%', paddingRight: 14 },
    amountColumn: { width: '34%', justifyContent: 'center' },
    factRow: { flexDirection: 'column', marginBottom: 4 },
    factLabel: { fontSize: 7.5, color: p.faint },
    factValue: { fontSize: 8.5, fontFamily: 'Helvetica-Bold' },
    table: { marginBottom: 12 },
    tableHeader: {
      flexDirection: 'row',
      backgroundColor: p.panel,
      borderTopWidth: 1,
      borderBottomWidth: 1,
      borderColor: p.border,
      paddingVertical: 6,
      paddingHorizontal: 6,
    },
    th: { fontSize: 7.5, fontFamily: 'Helvetica-Bold', color: p.accent, letterSpacing: 0.6 },
    tr: {
      flexDirection: 'row',
      paddingVertical: compact ? 6 : 8,
      paddingHorizontal: 6,
      borderBottomWidth: 1,
      borderBottomColor: '#EDF0F4',
    },
    td: { fontSize: 9 },
    colDescription: { flex: 1 },
    colAmount: { width: 150, textAlign: 'right' },
    totalRowStrong: {
      alignSelf: 'flex-end',
      width: 240,
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingVertical: 8,
      paddingHorizontal: 6,
      backgroundColor: p.accentSoft,
      borderRadius: 4,
    },
    totalStrong: { fontSize: 10.5, fontFamily: 'Helvetica-Bold', color: p.accent },
    footerNote: { fontSize: 8, color: p.muted, marginTop: 18 },
  });
}
